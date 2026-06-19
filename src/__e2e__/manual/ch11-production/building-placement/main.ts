/**
 * main.ts — Building Placement acceptance test
 *
 * OpenRA 对照:
 *   - OpenRA.Mods.Common/Traits/Player/PlaceBuilding.ts
 *   - OpenRA.Mods.Common/Traits/Buildings/BuildingUtils.ts
 *   - OpenRA.Mods.Common/Traits/Buildings/Building.ts (BuildingInfo)
 *
 * Verifies:
 *   E1. Ghost preview at 50% opacity following mouse cursor
 *   E2. Footprint cells matching BuildingInfo.footprint definition exactly
 *   E3. Valid placement = green (0.13,0.55,0.13), Invalid = red (0.76,0.14,0.14)
 *   E4. Grid snap to cell center ±0.1 wu
 *   E5. Rotation cycles through 4 cardinal directions (0°/90°/180°/270°)
 *
 * 坐标约定:
 *   - Cell (cx, cy) center = (cx + 0.5, 0, cy + 0.5) in world space
 *   - CPos: X=east-west, Y=north-south (matching OpenRA convention)
 *   - Rotation: 0° = default, 90° = CW (swap W/H), 180° = flip both, 270° = swap+flip
 */

import {
  Engine, Scene, ArcRotateCamera, HemisphericLight,
  Vector3, Color3, Color4, MeshBuilder, StandardMaterial,
  Mesh,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Grid Configuration
// ---------------------------------------------------------------------------

const GRID_W = 12
const GRID_H = 12
const CELL_SIZE = 1.0
const OOB_MARGIN = 2 // Extra cells shown beyond playable area

// Playable area bounds (inner area where placement is allowed)
const PLAYABLE_X_MIN = 1
const PLAYABLE_X_MAX = GRID_W - 1
const PLAYABLE_Y_MIN = 1
const PLAYABLE_Y_MAX = GRID_H - 1

// ---------------------------------------------------------------------------
// Building Type Definitions
//
// OpenRA 对照: ActorInfo with BuildingInfo, footprint string syntax:
//   'x' = Occupied, '=' = OccupiedPassable, '_' = Empty
//   footprint string is row-major: "xx=xx" for a 2x2 means:
//     (0,0)='x' (1,0)='x'
//     (0,1)='=' (1,1)='x'
// ---------------------------------------------------------------------------

type FootprintChar = 'x' | '=' | '_'

interface BuildingTypeDef {
  readonly name: string
  /** OpenRA footprint string (row-major, left-to-right, top-to-bottom) */
  readonly footprint: string
  readonly footprintW: number
  readonly footprintH: number
  /** Color when placed */
  readonly color: Color3
  /** Emissive */
  readonly emissive: Color3
  readonly id: string
}

const BUILDING_TYPES: Record<string, BuildingTypeDef> = {
  'power-plant': {
    name: '发电厂 (Power Plant)',
    footprint: 'xxxx',
    footprintW: 2,
    footprintH: 2,
    color: new Color3(0.87, 0.75, 0.27),
    emissive: new Color3(0.30, 0.25, 0.05),
    id: 'power-plant',
  },
  'barracks': {
    name: '兵营 (Barracks)',
    footprint: 'xx=x', // row 0: "xx", row 1: "=x" — one passable cell
    footprintW: 2,
    footprintH: 2,
    color: new Color3(0.40, 0.55, 0.80),
    emissive: new Color3(0.10, 0.15, 0.30),
    id: 'barracks',
  },
  'turret': {
    name: '防御炮塔 (Turret)',
    footprint: 'x',
    footprintW: 1,
    footprintH: 1,
    color: new Color3(0.70, 0.70, 0.70),
    emissive: new Color3(0.20, 0.20, 0.20),
    id: 'turret',
  },
}

// ---------------------------------------------------------------------------
// Footprint cell type for placement validation
// ---------------------------------------------------------------------------

const FootprintCellType = {
  Occupied: 'x' as const,
  OccupiedPassable: '=' as const,
  Empty: '_' as const,
} as const
type FootprintCellType = (typeof FootprintCellType)[keyof typeof FootprintCellType]

/** Parse a footprint character from the footprint string at a given (dx, dy) offset. */
function getFootprintChar(type: BuildingTypeDef, dx: number, dy: number, rotation: number): FootprintChar | null {
  const { footprintW, footprintH, footprint } = type
  // Apply rotation to map (dx, dy) back to the original footprint coordinate
  let origDx: number
  let origDy: number
  switch (rotation) {
    case 0:   origDx = dx;          origDy = dy;          break
    case 90:  origDx = dy;          origDy = footprintW - 1 - dx; break
    case 180: origDx = footprintW - 1 - dx; origDy = footprintH - 1 - dy; break
    case 270: origDx = footprintH - 1 - dy; origDy = dx;  break
    default:  origDx = dx;          origDy = dy;          break
  }
  if (origDx < 0 || origDx >= footprintW || origDy < 0 || origDy >= footprintH) return null
  // footprint string is row-major: row 0 first, then row 1, etc.
  const idx = origDy * footprintW + origDx
  return (footprint[idx] ?? 'x') as FootprintChar
}

// ---------------------------------------------------------------------------
// Rotation-dependent footprint dimensions
// ---------------------------------------------------------------------------

function getRotatedSize(type: BuildingTypeDef, rotation: number): { w: number; h: number } {
  if (rotation % 180 === 0) {
    return { w: type.footprintW, h: type.footprintH }
  }
  return { w: type.footprintH, h: type.footprintW }
}

// ---------------------------------------------------------------------------
// Obstacle cells (blocked for placement — simulate existing buildings/terrain)
// ---------------------------------------------------------------------------

const OBSTACLE_CELLS: ReadonlySet<string> = new Set([
  '4,4',
  '5,4', '5,5',
  '7,7', '8,7',
  '3,8', '4,8',
  '9,3',
])

function isObstacle(cx: number, cy: number): boolean {
  return OBSTACLE_CELLS.has(`${cx},${cy}`)
}

// ---------------------------------------------------------------------------
// Terrain-restricted cells (simulate water/rough terrain where some buildings
// can't be placed)
// ---------------------------------------------------------------------------

const WATER_CELLS: ReadonlySet<string> = new Set([
  '8,3', '9,3', '8,4', '9,4',
  '10,5', '10,6', '10,7',
])

function isWater(cx: number, cy: number): boolean {
  return WATER_CELLS.has(`${cx},${cy}`)
}

// ---------------------------------------------------------------------------
// Out-of-bounds check (playable area: 1-10)
// ---------------------------------------------------------------------------

function isOOB(cx: number, cy: number): boolean {
  return cx < PLAYABLE_X_MIN || cx >= PLAYABLE_X_MAX ||
         cy < PLAYABLE_Y_MIN || cy >= PLAYABLE_Y_MAX
}

// ---------------------------------------------------------------------------
// Placed Building State
// ---------------------------------------------------------------------------

interface PlacedBuilding {
  type: string
  cellX: number
  cellY: number
  rotation: number
  mesh: Mesh
  footprintMeshes: Mesh[]
}

const placedBuildings: PlacedBuilding[] = []

// ---------------------------------------------------------------------------
// Shared Materials (lazy-init, reused across all buildings)
// ---------------------------------------------------------------------------

let ghostValidMat: StandardMaterial | null = null
let ghostInvalidMat: StandardMaterial | null = null
let ghostPassableMat: StandardMaterial | null = null
let groundMat: StandardMaterial | null = null
let oobMat: StandardMaterial | null = null
let waterMat: StandardMaterial | null = null
let obstacleMat: StandardMaterial | null = null
let placedBuildingMats: Map<string, StandardMaterial> | null = null

// Ghost mesh (single ground plane for the entire building ghost)
let ghostMesh: Mesh | null = null
// Individual footprint cell highlight meshes
const footprintHighlightMeshes: Mesh[] = []

// ---------------------------------------------------------------------------
// Current State
// ---------------------------------------------------------------------------

let currentBuildingType: string = 'power-plant'
let hoverCell: { x: number; y: number } | null = null
let ghostIsValid: boolean = false
let buildingRotation: number = 0 // 0, 90, 180, 270

// ---------------------------------------------------------------------------
// Cell center in world space
// ---------------------------------------------------------------------------

function cellCenter(cx: number, cy: number): Vector3 {
  return new Vector3(cx * CELL_SIZE + CELL_SIZE / 2, 0, cy * CELL_SIZE + CELL_SIZE / 2)
}

// ---------------------------------------------------------------------------
// Placement validity check (mirrors BuildingUtils.isCellBuildable logic)
//
// OpenRA 对照: BuildingUtils.isCellBuildable(world, cell, actorInfo, buildingInfo, toIgnore)
//   Checks: map.contains → actor occupancy → building influence → ramp → terrain type
// ---------------------------------------------------------------------------

function isCellBuildable(cx: number, cy: number, _type: BuildingTypeDef, _rotation: number): boolean {
  if (isOOB(cx, cy)) return false
  if (isObstacle(cx, cy)) return false

  // Check if any placed building occupies this cell
  for (const pb of placedBuildings) {
    const bType = BUILDING_TYPES[pb.type]
    if (!bType) continue
    const size = getRotatedSize(bType, pb.rotation)
    if (cx >= pb.cellX && cx < pb.cellX + size.w &&
        cy >= pb.cellY && cy < pb.cellY + size.h) {
      return false
    }
  }

  // Water check: buildings cannot be placed on water
  // (simulating BuildingInfo.terrainTypes check)
  if (isWater(cx, cy)) return false

  return true
}

function isValidPlacement(cx: number, cy: number, type: BuildingTypeDef, rotation: number): boolean {
  const size = getRotatedSize(type, rotation)

  // Check all cells in the rotated footprint
  for (let dy = 0; dy < size.h; dy++) {
    for (let dx = 0; dx < size.w; dx++) {
      const px = cx + dx
      const py = cy + dy

      // Get the footprint character for this cell
      const fc = getFootprintChar(type, dx, dy, rotation)
      if (!fc || fc === FootprintCellType.Empty) continue

      // Occupied and OccupiedPassable cells both must be buildable
      if (!isCellBuildable(px, py, type, rotation)) return false
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// Get footprint cells for a building at a given position
// (mirrors BuildingInfo.tiles(cell) and BuildingInfo.footprintTiles)
// ---------------------------------------------------------------------------

function getFootprintCells(cx: number, cy: number, type: BuildingTypeDef, rotation: number): Array<{ cx: number; cy: number; type: string; buildable: boolean }> {
  const size = getRotatedSize(type, rotation)
  const result: Array<{ cx: number; cy: number; type: string; buildable: boolean }> = []

  for (let dy = 0; dy < size.h; dy++) {
    for (let dx = 0; dx < size.w; dx++) {
      const fc = getFootprintChar(type, dx, dy, rotation)
      if (!fc) continue
      const px = cx + dx
      const py = cy + dy
      let cellType = 'occupied'
      if (fc === FootprintCellType.Empty) cellType = 'empty'
      else if (fc === FootprintCellType.OccupiedPassable) cellType = 'passable'

      const buildable = fc === FootprintCellType.Empty
        ? true // empty cells don't need to be buildable
        : isCellBuildable(px, py, type, rotation)

      result.push({ cx: px, cy: py, type: cellType, buildable })
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Ghost Preview Update
// ---------------------------------------------------------------------------

function ensureMaterials(scene: Scene): void {
  if (!ghostValidMat) {
    // Valid placement: green (0.13, 0.55, 0.13) ±5%
    ghostValidMat = new StandardMaterial('ghostValid', scene)
    ghostValidMat.diffuseColor = new Color3(0.13, 0.55, 0.13)
    ghostValidMat.alpha = 0.50
    ghostValidMat.emissiveColor = new Color3(0.06, 0.25, 0.06)
    ghostValidMat.specularColor = new Color3(0, 0, 0)
    ghostValidMat.backFaceCulling = false
  }
  if (!ghostInvalidMat) {
    // Invalid placement: red (0.76, 0.14, 0.14) ±5%
    ghostInvalidMat = new StandardMaterial('ghostInvalid', scene)
    ghostInvalidMat.diffuseColor = new Color3(0.76, 0.14, 0.14)
    ghostInvalidMat.alpha = 0.50
    ghostInvalidMat.emissiveColor = new Color3(0.35, 0.04, 0.04)
    ghostInvalidMat.specularColor = new Color3(0, 0, 0)
    ghostInvalidMat.backFaceCulling = false
  }
  if (!ghostPassableMat) {
    // Passable cells in ghost: blue-ish tint
    ghostPassableMat = new StandardMaterial('ghostPassable', scene)
    ghostPassableMat.diffuseColor = new Color3(0.25, 0.25, 0.55)
    ghostPassableMat.alpha = 0.45
    ghostPassableMat.emissiveColor = new Color3(0.08, 0.08, 0.22)
    ghostPassableMat.specularColor = new Color3(0, 0, 0)
    ghostPassableMat.backFaceCulling = false
  }
}

function updateGhost(): void {
  if (!ghostMesh) return

  // Clear old footprint highlight meshes
  for (const m of footprintHighlightMeshes) {
    m.dispose()
  }
  footprintHighlightMeshes.length = 0

  if (!hoverCell || isOOB(hoverCell.x, hoverCell.y)) {
    ghostMesh.isVisible = false
    ghostIsValid = false
    updateStatsDisplay()
    updateFootprintDiag()
    return
  }

  const type = BUILDING_TYPES[currentBuildingType]
  if (!type) return

  const size = getRotatedSize(type, buildingRotation)
  const center = cellCenter(hoverCell.x, hoverCell.y)

  // Offset center for multi-cell footprints
  const offsetX = (size.w - 1) * CELL_SIZE / 2
  const offsetZ = (size.h - 1) * CELL_SIZE / 2

  ghostMesh.position = new Vector3(center.x + offsetX, 0.06, center.z + offsetZ)
  ghostMesh.scaling = new Vector3(size.w * CELL_SIZE, 0.01, size.h * CELL_SIZE)

  ghostIsValid = isValidPlacement(hoverCell.x, hoverCell.y, type, buildingRotation)
  ghostMesh.material = ghostIsValid ? ghostValidMat : ghostInvalidMat
  ghostMesh.isVisible = true

  // Create per-cell footprint highlight meshes
  const fCells = getFootprintCells(hoverCell.x, hoverCell.y, type, buildingRotation)
  for (const fc of fCells) {
    if (fc.type === 'empty') continue // Don't visualize empty cells

    const cCenter = cellCenter(fc.cx, fc.cy)
    const cellPlane = MeshBuilder.CreateGround(`fp_cell_${fc.cx}_${fc.cy}`, {
      width: CELL_SIZE * 0.92, height: CELL_SIZE * 0.92,
    }, ghostMesh.getScene())
    cellPlane.position = new Vector3(cCenter.x, 0.07, cCenter.z)
    cellPlane.isPickable = false

    if (fc.type === 'passable') {
      cellPlane.material = ghostPassableMat
    } else if (fc.buildable) {
      cellPlane.material = ghostValidMat
    } else {
      cellPlane.material = ghostInvalidMat
    }

    footprintHighlightMeshes.push(cellPlane)
  }

  updateStatsDisplay()
  updateFootprintDiag()
}

// ---------------------------------------------------------------------------
// Building Placement
// ---------------------------------------------------------------------------

function placeBuilding(cx: number, cy: number, typeId: string, rotation: number): PlacedBuilding | null {
  const type = BUILDING_TYPES[typeId]
  if (!type) return null
  if (!isValidPlacement(cx, cy, type, rotation)) return null
  if (isOOB(cx, cy)) return null

  const size = getRotatedSize(type, rotation)
  const center = cellCenter(cx, cy)
  const offsetX = (size.w - 1) * CELL_SIZE / 2
  const offsetZ = (size.h - 1) * CELL_SIZE / 2

  // Create building mesh
  const height = 0.4 + Math.random() * 0.15 // slight variation for visual distinction
  const mesh = MeshBuilder.CreateBox(`bld_${typeId}_${cx}_${cy}`, {
    width: size.w * CELL_SIZE * 0.88,
    height,
    depth: size.h * CELL_SIZE * 0.88,
  }, ghostMesh!.getScene())
  mesh.position = new Vector3(center.x + offsetX, height / 2 + 0.05, center.z + offsetZ)

  let mat = placedBuildingMats!.get(typeId)
  if (!mat) {
    mat = new StandardMaterial(`placed_${typeId}`, mesh.getScene())
    mat.diffuseColor = type.color.clone()
    mat.emissiveColor = type.emissive.clone()
    mat.specularColor = new Color3(0.05, 0.05, 0.05)
    placedBuildingMats!.set(typeId, mat)
  }
  mesh.material = mat

  // Create footprint indicator meshes for placed building
  const footprintMeshes: Mesh[] = []
  const fCells = getFootprintCells(cx, cy, type, rotation)
  for (const fc of fCells) {
    if (fc.type === 'empty') continue
    const cCenter = cellCenter(fc.cx, fc.cy)
    const fpMesh = MeshBuilder.CreateGround(`placed_fp_${fc.cx}_${fc.cy}`, {
      width: CELL_SIZE * 0.85, height: CELL_SIZE * 0.85,
    }, mesh.getScene())
    fpMesh.position = new Vector3(cCenter.x, 0.03, cCenter.z)
    fpMesh.isPickable = false

    if (fc.type === 'passable') {
      fpMesh.material = ghostPassableMat
    } else {
      fpMesh.material = ghostValidMat
    }
    footprintMeshes.push(fpMesh)
  }

  const building: PlacedBuilding = {
    type: typeId,
    cellX: cx,
    cellY: cy,
    rotation,
    mesh,
    footprintMeshes,
  }
  placedBuildings.push(building)

  updatePlacedCount()
  // Re-check ghost validity (new building may block current hover)
  updateGhost()
  return building
}

// ---------------------------------------------------------------------------
// Stats Display
// ---------------------------------------------------------------------------

function updatePlacedCount(): void {
  document.getElementById('stat-placed-count')!.textContent = String(placedBuildings.length)
}

function updateStatsDisplay(): void {
  const type = BUILDING_TYPES[currentBuildingType]
  document.getElementById('stat-building-type')!.textContent = type?.name ?? '-'
  document.getElementById('stat-rotation')!.textContent = `${buildingRotation}°`
  const size = type ? getRotatedSize(type, buildingRotation) : { w: 0, h: 0 }
  document.getElementById('stat-footprint-size')!.textContent = `${size.w}x${size.h}`

  if (hoverCell && !isOOB(hoverCell.x, hoverCell.y)) {
    document.getElementById('stat-hover-cell')!.textContent = `(${hoverCell.x}, ${hoverCell.y})`
    document.getElementById('stat-ghost-state')!.textContent = ghostIsValid ? '有效 (绿色)' : '无效 (红色)'
    if (ghostIsValid) {
      document.getElementById('stat-ghost-color')!.textContent = 'R=0.13 G=0.55 B=0.13'
    } else {
      document.getElementById('stat-ghost-color')!.textContent = 'R=0.76 G=0.14 B=0.14'
    }
    // Calculate snap offset
    if (ghostMesh && ghostMesh.isVisible) {
      const center = cellCenter(hoverCell.x, hoverCell.y)
      const offsetX = (size.w - 1) * CELL_SIZE / 2
      const offsetZ = (size.h - 1) * CELL_SIZE / 2
      const ghostPos = ghostMesh.position
      const targetPos = new Vector3(center.x + offsetX, 0.06, center.z + offsetZ)
      const dev = Vector3.Distance(ghostPos, targetPos)
      document.getElementById('stat-snap-offset')!.textContent = `${dev.toFixed(4)} wu`
    } else {
      document.getElementById('stat-snap-offset')!.textContent = '-'
    }
  } else {
    document.getElementById('stat-hover-cell')!.textContent = hoverCell
      ? `(${hoverCell.x}, ${hoverCell.y}) [OOB]`
      : '-'
    document.getElementById('stat-ghost-state')!.textContent = hoverCell ? '越界 (OOB)' : '-'
    document.getElementById('stat-ghost-color')!.textContent = '-'
    document.getElementById('stat-snap-offset')!.textContent = '-'
  }
}

function updateFootprintDiag(): void {
  const diagEl = document.getElementById('footprint-diag')!
  const cellsEl = document.getElementById('footprint-cells')!

  if (!hoverCell || isOOB(hoverCell.x, hoverCell.y)) {
    diagEl.innerHTML = '<div style="color:#667; padding:4px;">移动鼠标到格网上方查看 footprint</div>'
    cellsEl.innerHTML = '<div style="color:#667; padding:4px;">无数据</div>'
    return
  }

  const hc = hoverCell // capture for closure narrowing

  const type = BUILDING_TYPES[currentBuildingType]
  if (!type) return

  const size = getRotatedSize(type, buildingRotation)
  const fCells = getFootprintCells(hc.x, hc.y, type, buildingRotation)

  // Build grid visualization
  let html = ''
  for (let dy = 0; dy < size.h; dy++) {
    html += '<div style="display:flex;">'
    for (let dx = 0; dx < size.w; dx++) {
      const fc = fCells.find(c => c.cx === hc.x + dx && c.cy === hc.y + dy)
      let cls = 'fp-oob'
      let label = '?'
      if (fc) {
        if (fc.type === 'empty') { cls = ''; label = '_' }
        else if (fc.type === 'passable') { cls = 'fp-passable'; label = '=' }
        else if (fc.buildable) { cls = 'fp-valid'; label = 'x' }
        else { cls = 'fp-invalid'; label = 'x' }
      }
      html += `<span class="fp-cell ${cls}">${label}</span>`
    }
    html += '</div>'
  }
  diagEl.innerHTML = html

  // Build cell list
  let cellListHtml = ''
  for (const fc of fCells) {
    if (fc.type === 'empty') continue
    const status = fc.buildable ? 'OK' : 'BLOCKED'
    const statusColor = fc.buildable ? '#8f8' : '#f88'
    cellListHtml += `<div style="display:flex;gap:8px;">` +
      `<span style="color:#889;min-width:50px;">(${fc.cx},${fc.cy})</span>` +
      `<span style="color:#aaf;min-width:24px;">${fc.type}</span>` +
      `<span style="color:${statusColor};">${status}</span>` +
      `</div>`
  }
  cellsEl.innerHTML = cellListHtml || '<div style="color:#667; padding:4px;">无占用单元格</div>'
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
const camera = new ArcRotateCamera('cam', -Math.PI / 2, 0.3, totalExtent * 0.75, cameraTarget, scene)
camera.attachControl(canvas, true)
camera.lowerRadiusLimit = 3
camera.upperRadiusLimit = 30
camera.panningSensibility = 500
// Disable default mouse button handling to avoid conflicts with placement
camera.inputs.removeByType('ArcRotateCameraMouseWheelInput' as any)

// Re-add mouse wheel input for zoom
import { ArcRotateCameraMouseWheelInput } from '@babylonjs/core'
camera.inputs.add(new ArcRotateCameraMouseWheelInput())

new HemisphericLight('hemi', new Vector3(0.3, 1, 0.3), scene)

// ---------------------------------------------------------------------------
// Create Materials (shared, lazy-init)
// ---------------------------------------------------------------------------

ensureMaterials(scene)

// Building placed materials
placedBuildingMats = new Map()

// Ground (playable area)
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
oobMat.diffuseColor = new Color3(0.50, 0.30, 0.08)
oobMat.emissiveColor = new Color3(0.12, 0.06, 0.0)
oobMat.specularColor = new Color3(0, 0, 0)
const oobGround = MeshBuilder.CreateGround('oobGround', {
  width: (GRID_W + OOB_MARGIN * 2) * CELL_SIZE,
  height: (GRID_H + OOB_MARGIN * 2) * CELL_SIZE,
}, scene)
oobGround.position = new Vector3(GRID_W / 2 * CELL_SIZE, -0.06, GRID_H / 2 * CELL_SIZE)
oobGround.material = oobMat

// Water cells
waterMat = new StandardMaterial('water', scene)
waterMat.diffuseColor = new Color3(0.08, 0.23, 0.44)
waterMat.emissiveColor = new Color3(0.02, 0.06, 0.12)
waterMat.specularColor = new Color3(0.1, 0.1, 0.1)
waterMat.alpha = 0.85
for (const key of WATER_CELLS) {
  const [cx, cy] = key.split(',').map(Number)
  const cCenter = cellCenter(cx, cy)
  const waterMesh = MeshBuilder.CreateGround(`water_${cx}_${cy}`, {
    width: CELL_SIZE * 0.9, height: CELL_SIZE * 0.9,
  }, scene)
  waterMesh.position = new Vector3(cCenter.x, -0.03, cCenter.z)
  waterMesh.material = waterMat
}

// Obstacles
obstacleMat = new StandardMaterial('obstacle', scene)
obstacleMat.diffuseColor = new Color3(0.28, 0.28, 0.28)
obstacleMat.emissiveColor = new Color3(0.05, 0.05, 0.05)
obstacleMat.specularColor = new Color3(0, 0, 0)
for (const key of OBSTACLE_CELLS) {
  const [cx, cy] = key.split(',').map(Number)
  const cCenter = cellCenter(cx, cy)
  const obs = MeshBuilder.CreateCylinder(`obs_${cx}_${cy}`, {
    height: 0.45, diameter: CELL_SIZE * 0.5,
  }, scene)
  obs.position = new Vector3(cCenter.x, 0.23, cCenter.z)
  obs.material = obstacleMat
}

// ---------------------------------------------------------------------------
// Grid Lines
// ---------------------------------------------------------------------------

function createGridLines(): void {
  const points: Vector3[] = []

  // Boundary line between playable area and OOB
  const px0 = PLAYABLE_X_MIN * CELL_SIZE
  const px1 = PLAYABLE_X_MAX * CELL_SIZE
  const py0 = PLAYABLE_Y_MIN * CELL_SIZE
  const py1 = PLAYABLE_Y_MAX * CELL_SIZE

  // Playable area border (yellow-ish)
  const borderPoints = [
    new Vector3(px0, 0.02, py0), new Vector3(px1, 0.02, py0),
    new Vector3(px1, 0.02, py0), new Vector3(px1, 0.02, py1),
    new Vector3(px1, 0.02, py1), new Vector3(px0, 0.02, py1),
    new Vector3(px0, 0.02, py1), new Vector3(px0, 0.02, py0),
  ]
  const borderLines = MeshBuilder.CreateLines('border', { points: borderPoints }, scene)
  borderLines.color = new Color3(0.55, 0.45, 0.15)

  // Internal grid lines
  for (let x = 0; x <= GRID_W; x++) {
    points.push(new Vector3(x * CELL_SIZE, 0.01, 0))
    points.push(new Vector3(x * CELL_SIZE, 0.01, GRID_H * CELL_SIZE))
  }
  for (let y = 0; y <= GRID_H; y++) {
    points.push(new Vector3(0, 0.01, y * CELL_SIZE))
    points.push(new Vector3(GRID_W * CELL_SIZE, 0.01, y * CELL_SIZE))
  }
  const gridLines = MeshBuilder.CreateLines('gridLines', { points }, scene)
  gridLines.color = new Color3(0.18, 0.22, 0.32)
}

createGridLines()

// ---------------------------------------------------------------------------
// Ghost Mesh (single plane for the overall building footprint)
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
  updateGhost()
})

canvas.addEventListener('click', (e) => {
  if (e.button !== 0) return
  if (!hoverCell || !ghostIsValid || isOOB(hoverCell.x, hoverCell.y)) return

  placeBuilding(hoverCell.x, hoverCell.y, currentBuildingType, buildingRotation)
})

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  // Right-click cycles through building types
  const types = Object.keys(BUILDING_TYPES)
  const idx = types.indexOf(currentBuildingType)
  currentBuildingType = types[(idx + 1) % types.length]
  updateBuildingButtons()
  updateGhost()
})

// ---------------------------------------------------------------------------
// Keyboard Shortcuts
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

  switch (e.key.toLowerCase()) {
    case 'r': {
      // Rotate building
      buildingRotation = (buildingRotation + 90) % 360
      updateGhost()
      break
    }
    case '1': {
      currentBuildingType = 'power-plant'
      updateBuildingButtons()
      updateGhost()
      break
    }
    case '2': {
      currentBuildingType = 'barracks'
      updateBuildingButtons()
      updateGhost()
      break
    }
    case '3': {
      currentBuildingType = 'turret'
      updateBuildingButtons()
      updateGhost()
      break
    }
    case 'escape': {
      // Deselect hover
      hoverCell = null
      updateGhost()
      break
    }
  }
})

// ---------------------------------------------------------------------------
// UI Controls
// ---------------------------------------------------------------------------

function updateBuildingButtons(): void {
  for (const type of Object.keys(BUILDING_TYPES)) {
    const btnId = `btn-${type}`
    document.getElementById(btnId)!.classList.toggle('active', currentBuildingType === type)
  }
}

document.getElementById('btn-power-plant')!.addEventListener('click', () => {
  currentBuildingType = 'power-plant'
  updateBuildingButtons()
  updateGhost()
})

document.getElementById('btn-barracks')!.addEventListener('click', () => {
  currentBuildingType = 'barracks'
  updateBuildingButtons()
  updateGhost()
})

document.getElementById('btn-turret')!.addEventListener('click', () => {
  currentBuildingType = 'turret'
  updateBuildingButtons()
  updateGhost()
})

document.getElementById('btn-place')!.addEventListener('click', () => {
  if (hoverCell && ghostIsValid && !isOOB(hoverCell.x, hoverCell.y)) {
    placeBuilding(hoverCell.x, hoverCell.y, currentBuildingType, buildingRotation)
  }
})

document.getElementById('btn-rotate')!.addEventListener('click', () => {
  buildingRotation = (buildingRotation + 90) % 360
  updateGhost()
})

document.getElementById('btn-reset')!.addEventListener('click', () => {
  resetAll()
})

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

function resetAll(): void {
  for (const pb of placedBuildings) {
    pb.mesh.dispose()
    for (const fm of pb.footprintMeshes) {
      fm.dispose()
    }
  }
  placedBuildings.length = 0
  buildingRotation = 0
  updatePlacedCount()
  updateGhost()
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
// Test Harness (for automated/scripted testing)
//
// OpenRA 对照: N/A (test-only interface)
//
// Exposed on window.__testHarness for Playwright/console access.
// ---------------------------------------------------------------------------

interface BuildingGhostInfo {
  visible: boolean
  color: { r: number; g: number; b: number }
  alpha: number
  valid: boolean
  cellX: number
  cellY: number
}

interface FootprintCellInfo {
  cx: number
  cy: number
  type: string
  buildable: boolean
}

const testHarness = {
  /**
   * Select a building type for placement.
   * @param type - 'power-plant' | 'barracks' | 'turret'
   */
  selectBuilding(type: string): void {
    if (BUILDING_TYPES[type]) {
      currentBuildingType = type
      updateBuildingButtons()
      updateGhost()
    }
  },

  /**
   * Move the cursor to a specific grid cell (simulates mouse hover).
   * @param cell - { x: number, y: number }
   */
  moveCursorToCell(cell: { x: number; y: number }): void {
    hoverCell = { x: cell.x, y: cell.y }
    updateGhost()
  },

  /**
   * Check whether the current hover cell is a valid placement.
   * @returns true if valid placement, false otherwise
   */
  canPlace(): boolean {
    return ghostIsValid
  },

  /**
   * Get the color of a specific footprint cell at the current hover position.
   * @param cell - { x: number, y: number } (absolute grid coordinate)
   * @returns { r, g, b } values (0-1 range) or null if not in footprint
   */
  getCellColor(cell: { x: number; y: number }): { r: number; g: number; b: number } | null {
    if (!hoverCell || isOOB(hoverCell.x, hoverCell.y)) return null
    const type = BUILDING_TYPES[currentBuildingType]
    if (!type) return null
    const fCells = getFootprintCells(hoverCell.x, hoverCell.y, type, buildingRotation)
    const fc = fCells.find(c => c.cx === cell.x && c.cy === cell.y)
    if (!fc || fc.type === 'empty') return null
    if (fc.type === 'passable') return { r: 0.25, g: 0.25, b: 0.55 }
    if (fc.buildable) return { r: 0.13, g: 0.55, b: 0.13 }
    return { r: 0.76, g: 0.14, b: 0.14 }
  },

  /**
   * Rotate the building by 90 degrees clockwise.
   * @returns the new rotation angle (0, 90, 180, or 270)
   */
  rotateBuilding(): number {
    buildingRotation = (buildingRotation + 90) % 360
    updateGhost()
    return buildingRotation
  },

  /**
   * Get all footprint cells for the current building at the hover position.
   * @returns Array of { cx, cy, type, buildable } for each footprint cell
   */
  getFootprintCells(): FootprintCellInfo[] {
    if (!hoverCell || isOOB(hoverCell.x, hoverCell.y)) return []
    const type = BUILDING_TYPES[currentBuildingType]
    if (!type) return []
    return getFootprintCells(hoverCell.x, hoverCell.y, type, buildingRotation)
  },

  /**
   * Get info about the current ghost preview.
   * @returns ghost info or null if not visible
   */
  getGhostInfo(): BuildingGhostInfo | null {
    if (!ghostMesh || !ghostMesh.isVisible || !hoverCell) return null
    const validColor = ghostIsValid
      ? { r: 0.13, g: 0.55, b: 0.13 }
      : { r: 0.76, g: 0.14, b: 0.14 }
    return {
      visible: true,
      color: validColor,
      alpha: 0.50,
      valid: ghostIsValid,
      cellX: hoverCell.x,
      cellY: hoverCell.y,
    }
  },

  /**
   * Get all placed buildings.
   * @returns Array of { type, cellX, cellY, rotation } for each placed building
   */
  getPlacedBuildings(): Array<{ type: string; cellX: number; cellY: number; rotation: number }> {
    return placedBuildings.map(pb => ({
      type: pb.type,
      cellX: pb.cellX,
      cellY: pb.cellY,
      rotation: pb.rotation,
    }))
  },

  /**
   * Get the current building rotation.
   */
  getRotation(): number {
    return buildingRotation
  },

  /**
   * Get the current building type.
   */
  getBuildingType(): string {
    return currentBuildingType
  },

  /**
   * Place a building programmatically at the given cell.
   * @param type - building type id
   * @param cell - { x: number, y: number }
   * @param rotation - rotation angle (0, 90, 180, 270)
   * @returns the placed building info or null
   */
  placeAt(type: string, cell: { x: number; y: number }, rotation?: number): { type: string; cellX: number; cellY: number; rotation: number } | null {
    const rot = rotation ?? 0
    const result = placeBuilding(cell.x, cell.y, type, rot)
    return result ? { type: result.type, cellX: result.cellX, cellY: result.cellY, rotation: result.rotation } : null
  },

  /**
   * Get grid dimensions.
   */
  getGridSize(): { width: number; height: number; playableXMin: number; playableXMax: number; playableYMin: number; playableYMax: number } {
    return {
      width: GRID_W,
      height: GRID_H,
      playableXMin: PLAYABLE_X_MIN,
      playableXMax: PLAYABLE_X_MAX,
      playableYMin: PLAYABLE_Y_MIN,
      playableYMax: PLAYABLE_Y_MAX,
    }
  },

  /**
   * Check if a specific cell is an obstacle.
   */
  isObstacle(cx: number, cy: number): boolean {
    return isObstacle(cx, cy) || isOOB(cx, cy) || isWater(cx, cy)
  },

  /**
   * Get the list of available building types.
   */
  getBuildingTypes(): string[] {
    return Object.keys(BUILDING_TYPES)
  },

  /**
   * Reset the entire scene.
   */
  reset(): void {
    resetAll()
  },
}

;(window as any).__testHarness = testHarness
