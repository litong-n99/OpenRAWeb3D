/**
 * path-follow-visual/main.ts -- Unit path following visual acceptance test
 *
 * OpenRA对照: OpenRA.Mods.Common/Traits/Mobile.ts + World/Locomotor.ts +
 *             Pathfinder/HierarchicalPathFinder.ts
 *
 * Verifies unit movement along a path of waypoints:
 *   E1. Speed accuracy — unit moves at configured speed (within 5%)
 *   E2. Smooth waypoint traversal — no teleport, no stall between waypoints
 *   E3. Destination arrival — reaches within 2 world units of target
 *   E4. Path overlay — all waypoints visualized from source to destination
 *   E5. Approach deceleration — speed reduced in final approach segment
 *
 * 坐标系约定 (from WPos/WVec/WAngle, matching OpenRA conventions):
 *   - WAngle 0 = North (WPos -Y direction), counter-clockwise increment
 *   - WPos: X = east-west, Y = north-south, Z = height
 *   - Babylon mapping: Vector3(x = WPos.X/1024, y = WPos.Z/512, z = WPos.Y/1024)
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
} from '@babylonjs/core'

import { WPos } from '../../../../OpenRA.Game/WPos.js'
import { WAngle } from '../../../../OpenRA.Game/WAngle.js'

// ---------------------------------------------------------------------------
// Coordinate conversion constants
// ---------------------------------------------------------------------------

const WORLD_SCALE = 1 / 1024
const HEIGHT_SCALE = 1 / 512

/** Convert OpenRA WPos (integer su) to Babylon Vector3 (world units). */
function wPosToVector3(wx: number, wy: number, wz: number): Vector3 {
  return new Vector3(wx * WORLD_SCALE, wz * HEIGHT_SCALE, wy * WORLD_SCALE)
}

// ---------------------------------------------------------------------------
// Grid & Pathfinding Constants
// ---------------------------------------------------------------------------

/** Visible grid dimensions (cells). */
const GRID_WIDTH = 20
const GRID_HEIGHT = 20

/** Cell center offset in WPos: 512,512 = half a cell. */
const CELL_CENTER_OFFSET = 512

/** Convert grid (col, row) to WPos at cell center. */
function gridToWPos(col: number, row: number): WPos {
  return new WPos(
    col * 1024 + CELL_CENTER_OFFSET,
    row * 1024 + CELL_CENTER_OFFSET,
    0,
  )
}

/** Convert WPos to nearest grid cell (clamped). */
function wPosToGrid(pos: WPos): { col: number; row: number } {
  return {
    col: Math.max(0, Math.min(GRID_WIDTH - 1, Math.floor(pos.X / 1024))),
    row: Math.max(0, Math.min(GRID_HEIGHT - 1, Math.floor(pos.Y / 1024))),
  }
}

// ---------------------------------------------------------------------------
// Obstacle definitions (cells that block pathfinding)
// ---------------------------------------------------------------------------

/** Predefined obstacle wall cells for the "obstacle" scenario. */
const OBSTACLE_CELLS: readonly string[] = [
  // Horizontal wall across middle of map (row 9-10, cols 5-14)
  '5,9', '6,9', '7,9', '8,9', '9,9', '10,9', '11,9', '12,9', '13,9', '14,9',
  '5,10', '6,10', '7,10', '8,10', '9,10', '10,10', '11,10', '12,10', '13,10', '14,10',
]

function isObstacleCell(col: number, row: number): boolean {
  return OBSTACLE_CELLS.includes(`${col},${row}`)
}

// ---------------------------------------------------------------------------
// BFS Pathfinding (simplified — uniform cost grid)
// ---------------------------------------------------------------------------

interface Waypoint {
  col: number
  row: number
  wPos: WPos
}

/** Find shortest path from source to destination using BFS (uniform cost). */
function findPathBFS(
  src: { col: number; row: number },
  dst: { col: number; row: number },
): Waypoint[] | null {
  if (src.col === dst.col && src.row === dst.row) {
    return [{ col: src.col, row: src.row, wPos: gridToWPos(src.col, src.row) }]
  }

  const visited = new Set<string>()
  const parent = new Map<string, string | null>()
  const queue: { col: number; row: number }[] = [src]
  const key = (c: number, r: number) => `${c},${r}`
  visited.add(key(src.col, src.row))
  parent.set(key(src.col, src.row), null)

  const directions = [
    { dc: 0, dr: -1 },  // North (-Y)
    { dc: 1, dr: -1 },  // Northeast
    { dc: 1, dr: 0 },   // East (+X)
    { dc: 1, dr: 1 },   // Southeast
    { dc: 0, dr: 1 },   // South (+Y)
    { dc: -1, dr: 1 },  // Southwest
    { dc: -1, dr: 0 },  // West (-X)
    { dc: -1, dr: -1 }, // Northwest
  ]

  let found = false
  while (queue.length > 0 && !found) {
    const current = queue.shift()!
    for (const dir of directions) {
      const nc = current.col + dir.dc
      const nr = current.row + dir.dr
      const nk = key(nc, nr)
      if (
        nc >= 0 && nc < GRID_WIDTH &&
        nr >= 0 && nr < GRID_HEIGHT &&
        !visited.has(nk) &&
        !isObstacleCell(nc, nr)
      ) {
        visited.add(nk)
        parent.set(nk, key(current.col, current.row))
        if (nc === dst.col && nr === dst.row) {
          parent.set(key(dst.col, dst.row), key(current.col, current.row))
          found = true
          break
        }
        queue.push({ col: nc, row: nr })
      }
    }
  }

  if (!found) return null

  // Reconstruct path
  const waypoints: Waypoint[] = []
  let ck: string | null = key(dst.col, dst.row)
  while (ck !== null) {
    const [cStr, rStr] = ck.split(',')
    const col = parseInt(cStr!, 10)
    const row = parseInt(rStr!, 10)
    waypoints.unshift({ col, row, wPos: gridToWPos(col, row) })
    ck = parent.get(ck) ?? null
  }
  return waypoints
}

// ---------------------------------------------------------------------------
// Babylon.js Scene Setup
// ---------------------------------------------------------------------------

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true })
const scene = new Scene(engine)
scene.clearColor = new Color4(0.06, 0.08, 0.12, 1)

const camera = new ArcRotateCamera(
  'cam',
  -Math.PI / 2,   // alpha: looking from "south" direction
  Math.PI / 3.5,  // beta: ~51 degrees elevation
  32,
  new Vector3(10, 0, 10),
  scene,
)
camera.lowerRadiusLimit = 5
camera.upperRadiusLimit = 80
camera.attachControl(canvas, true)

const light = new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)
light.intensity = 0.85

// Ground plane
const ground = MeshBuilder.CreateGround('ground', { width: 22, height: 22 }, scene)
ground.position.set(GRID_WIDTH / 2 - 0.5, -0.02, GRID_HEIGHT / 2 - 0.5)
const gmat = new StandardMaterial('gmat', scene)
gmat.diffuseColor = new Color3(0.10, 0.13, 0.18)
gmat.specularColor = new Color3(0, 0, 0)
gmat.alpha = 0.75
ground.material = gmat

// Grid lines
for (let i = 0; i <= GRID_WIDTH; i++) {
  const pts = [
    new Vector3(i, 0.005, 0),
    new Vector3(i, 0.005, GRID_HEIGHT),
  ]
  const line = MeshBuilder.CreateLines('gridX', { points: pts }, scene)
  line.color = new Color3(0.15, 0.25, 0.4)
  line.alpha = i % 5 === 0 ? 0.4 : 0.10
}
for (let j = 0; j <= GRID_HEIGHT; j++) {
  const pts = [
    new Vector3(0, 0.005, j),
    new Vector3(GRID_WIDTH, 0.005, j),
  ]
  const line = MeshBuilder.CreateLines('gridZ', { points: pts }, scene)
  line.color = new Color3(0.15, 0.25, 0.4)
  line.alpha = j % 5 === 0 ? 0.4 : 0.10
}

// ---------------------------------------------------------------------------
// Obstacle visual blocks
// ---------------------------------------------------------------------------

const obstacleMeshes: Mesh[] = []
const obstacleMat = new StandardMaterial('obstacleMat', scene)
obstacleMat.diffuseColor = new Color3(0.5, 0.2, 0.1)
obstacleMat.specularColor = new Color3(0, 0, 0)

function renderObstacles(visible: boolean): void {
  // Dispose existing
  for (const m of obstacleMeshes) m.dispose()
  obstacleMeshes.length = 0

  if (!visible) return

  for (const key of OBSTACLE_CELLS) {
    const [cStr, rStr] = key.split(',')
    const col = parseInt(cStr!, 10)
    const row = parseInt(rStr!, 10)
    const box = MeshBuilder.CreateBox(`obstacle_${key}`, {
      width: 0.9, height: 0.6, depth: 0.9,
    }, scene)
    box.position.set(col + 0.5, 0.3, row + 0.5)
    box.material = obstacleMat
    obstacleMeshes.push(box)
  }
}

// ---------------------------------------------------------------------------
// Shared Materials
// ---------------------------------------------------------------------------

const sourceMarkerMat = new StandardMaterial('srcMat', scene)
sourceMarkerMat.diffuseColor = new Color3(0.2, 1, 0.2)
sourceMarkerMat.emissiveColor = new Color3(0.1, 0.5, 0.1)
sourceMarkerMat.specularColor = new Color3(0, 0, 0)

const destinationMarkerMat = new StandardMaterial('dstMat', scene)
destinationMarkerMat.diffuseColor = new Color3(1, 0.2, 0.2)
destinationMarkerMat.emissiveColor = new Color3(0.4, 0.1, 0.1)
destinationMarkerMat.specularColor = new Color3(0, 0, 0)

const unitMat = new StandardMaterial('unitMat', scene)
unitMat.diffuseColor = new Color3(0.3, 0.6, 1.0)
unitMat.emissiveColor = new Color3(0.1, 0.3, 0.5)
unitMat.specularColor = new Color3(0.1, 0.1, 0.1)

// Trail dot gradient materials (cyan → white → red)
const TRAIL_GRADIENT_STEPS = 10
const trailMaterials: StandardMaterial[] = []
for (let i = 0; i < TRAIL_GRADIENT_STEPS; i++) {
  const t = i / (TRAIL_GRADIENT_STEPS - 1)
  let r: number, g: number, b: number
  if (t <= 0.5) {
    const s = t / 0.5
    r = s; g = 1; b = 1
  } else {
    const s = (t - 0.5) / 0.5
    r = 1; g = 1 - s; b = 1 - s
  }
  const mat = new StandardMaterial(`trail${i}`, scene)
  mat.diffuseColor = new Color3(r, g, b)
  mat.emissiveColor = new Color3(r * 0.5, g * 0.3, b * 0.2)
  mat.specularColor = new Color3(0, 0, 0)
  trailMaterials.push(mat)
}

// ---------------------------------------------------------------------------
// Scene Objects
// ---------------------------------------------------------------------------

const unitMesh = MeshBuilder.CreateBox('unit', { width: 0.5, height: 0.35, depth: 0.5 }, scene)
unitMesh.material = unitMat
unitMesh.position.set(0, 0.25, 0)
unitMesh.visibility = 0

const sourceMarker = MeshBuilder.CreateSphere('srcMarker', { diameter: 0.35 }, scene)
sourceMarker.material = sourceMarkerMat
sourceMarker.visibility = 0

const destinationMarker = MeshBuilder.CreateSphere('dstMarker', { diameter: 0.35 }, scene)
destinationMarker.material = destinationMarkerMat
destinationMarker.visibility = 0

// Direction indicator (small cone/line on unit showing current facing)
const facingLine = MeshBuilder.CreateCylinder('facingLine', {
  height: 0.6, diameterTop: 0.02, diameterBottom: 0.06,
}, scene)
facingLine.position.set(0, 0.5, 0)
facingLine.visibility = 0
const facingLineMat = new StandardMaterial('facingMat', scene)
facingLineMat.diffuseColor = new Color3(1, 1, 0.4)
facingLineMat.emissiveColor = new Color3(0.5, 0.5, 0.2)
facingLineMat.specularColor = new Color3(0, 0, 0)
facingLine.material = facingLineMat

// ---------------------------------------------------------------------------
// Path Visualization
// ---------------------------------------------------------------------------

let pathLine: LinesMesh | null = null
let visitedLine: LinesMesh | null = null
const trailDots: Mesh[] = []
let pathWaypointMarkers: Mesh[] = []
const waypointMarkerMat = new StandardMaterial('wpMat', scene)
waypointMarkerMat.diffuseColor = new Color3(0.6, 0.6, 1.0)
waypointMarkerMat.emissiveColor = new Color3(0.2, 0.2, 0.5)
waypointMarkerMat.specularColor = new Color3(0, 0, 0)
waypointMarkerMat.alpha = 0.7

/** Draw path line through all waypoints in Babylon world space. */
function drawPathLine(waypoints: readonly Waypoint[]): void {
  if (pathLine) { pathLine.dispose(); pathLine = null }
  if (waypoints.length < 2) return

  const pts = waypoints.map(w => wPosToVector3(w.wPos.X, w.wPos.Y, w.wPos.Z))
  pathLine = MeshBuilder.CreateLines('pathLine', { points: pts, updatable: true }, scene)
  pathLine.color = new Color3(1, 1, 1)
  pathLine.alpha = 0.7
}

/** Draw visited path segment (source to current position). */
function drawVisitedLine(visitedWorldPoses: readonly WPos[]): void {
  if (visitedLine) { visitedLine.dispose(); visitedLine = null }
  if (visitedWorldPoses.length < 2) return

  const pts = visitedWorldPoses.map(p => wPosToVector3(p.X, p.Y, p.Z))
  visitedLine = MeshBuilder.CreateLines('visitedLine', { points: pts }, scene)
  visitedLine.color = new Color3(0.2, 1, 0.2)
  visitedLine.alpha = 0.9
}

/** Clear all path visualization. */
function clearPathVisualization(): void {
  if (pathLine) { pathLine.dispose(); pathLine = null }
  if (visitedLine) { visitedLine.dispose(); visitedLine = null }
  for (const d of trailDots) d.dispose()
  trailDots.length = 0
  for (const m of pathWaypointMarkers) m.dispose()
  pathWaypointMarkers.length = 0
}

// ---------------------------------------------------------------------------
// Simulation State
// ---------------------------------------------------------------------------

/** Unit state for movement simulation. */
interface UnitState {
  /** Current WPos position. */
  position: WPos
  /** Current facing angle (WAngle, 0=North). */
  facing: WAngle
  /** Movement speed in su/tick. */
  speed: number
  /** Index of the next waypoint to move toward. */
  nextWaypointIndex: number
  /** Whether the unit has reached its final destination. */
  atDestination: boolean
  /** Array of waypoints to traverse. */
  waypoints: Waypoint[]
  /** Source WPos (start of path). */
  sourcePos: WPos
  /** Destination WPos (target). */
  destPos: WPos
  /** Total ticks since movement started. */
  ticksRunning: number
  /** Accumulated distance traveled (in su). */
  totalDistanceTraveled: number
  /** Whether movement is active. */
  active: boolean
  /** Trail of visited positions for path visualization. */
  visitedPositions: WPos[]
  /** Whether the simulator is paused. */
  paused: boolean
  /** Obstacle mode: whether obstacles are visible. */
  obstacleMode: boolean
}

let unitState: UnitState = createDefaultUnitState()

function createDefaultUnitState(): UnitState {
  return {
    position: WPos.Zero,
    facing: WAngle.fromFacing(128), // South
    speed: 1024, // Default: 1 cell/tick
    nextWaypointIndex: 1,
    atDestination: false,
    waypoints: [],
    sourcePos: WPos.Zero,
    destPos: WPos.Zero,
    ticksRunning: 0,
    totalDistanceTraveled: 0,
    active: false,
    visitedPositions: [],
    paused: false,
    obstacleMode: false,
  }
}

// ---------------------------------------------------------------------------
// Movement Logic
// ---------------------------------------------------------------------------

/** "Close enough" threshold in su for reaching a waypoint. */
const CLOSE_ENOUGH_SU = 256 // 0.25 cells (0.25 wu)

/** "Close enough" threshold in su for reaching final destination. */
const DEST_CLOSE_ENOUGH_SU = 2048 // 2 world units

/** Deceleration zone: slow down over last N waypoints. */
const DECELERATION_WAYPOINTS = 2

/**
 * Advance the unit one tick toward the next waypoint.
 * Returns true if the unit is still moving.
 */
function tickMovement(): boolean {
  if (!unitState.active || unitState.atDestination || unitState.paused) return unitState.active

  const wp = unitState.waypoints[unitState.nextWaypointIndex]
  if (!wp) {
    // No more waypoints — we've reached destination
    unitState.atDestination = true
    unitState.active = false
    addLog(unitState.ticksRunning, 'state', 'DESTINATION REACHED')
    return false
  }

  const currentPos = unitState.position
  const targetPos = wp.wPos
  const delta = WPos.subtract(targetPos, currentPos)
  const distToWP = delta.horizontalLength

  if (distToWP <= CLOSE_ENOUGH_SU) {
    // Snap to waypoint center and advance
    unitState.position = targetPos
    unitState.visitedPositions.push(targetPos)
    unitState.nextWaypointIndex++
    addLog(
      unitState.ticksRunning,
      'wp',
      `Waypoint ${unitState.nextWaypointIndex - 1}/${unitState.waypoints.length} reached at (${targetPos.X}, ${targetPos.Y})`
    )

    // Check if this was the final waypoint
    if (unitState.nextWaypointIndex >= unitState.waypoints.length) {
      const distToDest = WPos.subtract(unitState.destPos, targetPos).horizontalLength
      if (distToDest <= DEST_CLOSE_ENOUGH_SU) {
        unitState.atDestination = true
        unitState.active = false
        addLog(unitState.ticksRunning, 'state', 'DESTINATION REACHED')
        return false
      }
    }
    return true
  }

  // Calculate movement for this tick
  let tickSpeed = unitState.speed

  // Deceleration: reduce speed when near destination
  const remainingWaypoints = unitState.waypoints.length - unitState.nextWaypointIndex
  if (remainingWaypoints <= DECELERATION_WAYPOINTS) {
    const decelFactor = 0.5 + (remainingWaypoints / DECELERATION_WAYPOINTS) * 0.5
    tickSpeed = Math.round(unitState.speed * decelFactor)
  }

  // Move toward waypoint
  const moveDist = Math.min(tickSpeed, distToWP)
  const dirX = delta.X / delta.horizontalLength
  const dirY = delta.Y / delta.horizontalLength

  const newX = currentPos.X + Math.round(dirX * moveDist)
  const newY = currentPos.Y + Math.round(dirY * moveDist)
  unitState.position = new WPos(newX, newY, 0)
  unitState.totalDistanceTraveled += moveDist

  // Update facing to point toward the waypoint
  const hFacing = WAngle.fromFacing(facingFromDelta(dirX, dirY))
  unitState.facing = hFacing

  // Record visited position occasionally
  if (unitState.ticksRunning % 3 === 0) {
    unitState.visitedPositions.push(unitState.position)
  }

  unitState.ticksRunning++
  return true
}

/** Convert a direction vector to a facing angle (OpenRA convention). */
function facingFromDelta(dx: number, dy: number): number {
  // WAngle 0=North (0,-1), 64=East (1,0), 128=South (0,1), 192=West (-1,0)
  // atan2 convention: atan2(dx, -dy) ... WAngle angle = atan2(Y, X) with north-at-zero
  const rad = Math.atan2(dx, -dy) // dx = east, -dy = north
  let angle = (rad / (2 * Math.PI)) * 256
  if (angle < 0) angle += 256
  return Math.round(angle) % 256
}

// ---------------------------------------------------------------------------
// Path Setup & Movement Commands
// ---------------------------------------------------------------------------

/** Configure and start a movement from source to destination. */
function startMovement(
  src: { col: number; row: number },
  dst: { col: number; row: number },
  obstacleMode: boolean,
): void {
  resetSimulation()
  unitState.obstacleMode = obstacleMode

  const waypoints = findPathBFS(src, dst)
  if (!waypoints || waypoints.length < 2) {
    addLog(0, 'error', 'No path found between source and destination')
    return
  }

  // Set up unit state
  const firstWP = waypoints[0]!
  const lastWP = waypoints[waypoints.length - 1]!

  unitState.position = firstWP.wPos
  unitState.sourcePos = firstWP.wPos
  unitState.destPos = lastWP.wPos
  unitState.waypoints = waypoints
  unitState.nextWaypointIndex = 1
  unitState.active = true
  unitState.atDestination = false
  unitState.ticksRunning = 0
  unitState.totalDistanceTraveled = 0
  unitState.visitedPositions = [firstWP.wPos]

  // Orient unit toward first waypoint
  if (waypoints.length > 1) {
    const wp1 = waypoints[1]!
    const dx = wp1.col - firstWP.col
    const dy = wp1.row - firstWP.row
    unitState.facing = WAngle.fromFacing(facingFromDelta(dx, dy))
  } else {
    unitState.facing = WAngle.fromFacing(128) // South
  }

  // Show unit
  const pos3 = wPosToVector3(unitState.position.X, unitState.position.Y, 0)
  unitMesh.position.set(pos3.x, pos3.y + 0.25, pos3.z)
  unitMesh.visibility = 1
  facingLine.visibility = 1
  updateUnitOrientation()

  // Source marker
  sourceMarker.position = pos3
  sourceMarker.visibility = 1

  // Destination marker
  const dst3 = wPosToVector3(lastWP.wPos.X, lastWP.wPos.Y, 0)
  destinationMarker.position = dst3
  destinationMarker.visibility = 1

  // Path visualization
  drawPathLine(waypoints)

  // Render obstacles
  renderObstacles(obstacleMode)

  addLog(0, 'start', `Path found: ${waypoints.length} waypoints, dist=${calcPathDistance(waypoints)} su`)
  addLog(0, 'start', `Speed=${unitState.speed} su/tick (${(unitState.speed / 1024).toFixed(1)} cells/tick)`)
  addLog(0, 'start', `Source=(${firstWP.col},${firstWP.row}) Dest=(${lastWP.col},${lastWP.row})`)

  updateDiagnostics()
}

/** Calculate total path distance in su (Manhattan + diagonal approx). */
function calcPathDistance(waypoints: readonly Waypoint[]): number {
  let total = 0
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1]!.wPos
    const b = waypoints[i]!.wPos
    total += WPos.subtract(b, a).horizontalLength
  }
  return total
}

function updateUnitOrientation(): void {
  // WAngle to yaw: 0=North → facing -Z in Babylon, 64=East → +X, CCW
  // Babylon yaw: rotation around Y axis, 0=-Z, positive=CCW (looking from above)
  const yawRad = (unitState.facing.angle * Math.PI * 2) / 256 - Math.PI / 2
  unitMesh.rotation.y = yawRad

  // Facing indicator
  facingLine.position.set(unitMesh.position.x, unitMesh.position.y + 0.2, unitMesh.position.z)
  facingLine.rotation.y = yawRad
  facingLine.rotation.x = Math.PI / 2 // Cylinder is Y-up by default, lay it flat
}

// ---------------------------------------------------------------------------
// Simulation Tick
// ---------------------------------------------------------------------------

const SIM_TICK_INTERVAL = 3 // 1 logic tick per N render frames
let frameCounter = 0

function simulateTick(): void {
  if (!unitState.active || unitState.atDestination || unitState.paused) return

  const wasActive = tickMovement()

  // Update unit 3D position
  const pos3 = wPosToVector3(unitState.position.X, unitState.position.Y, 0)
  unitMesh.position.set(pos3.x, pos3.y + 0.25, pos3.z)
  updateUnitOrientation()

  // Add trail dot every N ticks
  if (unitState.ticksRunning % 5 === 0 && unitState.ticksRunning > 0) {
    addTrailDot(unitState.position, Math.min(1, unitState.ticksRunning / 200))
  }

  // Rebuild visited line periodically
  if (unitState.visitedPositions.length % 8 === 0) {
    drawVisitedLine(unitState.visitedPositions)
  }

  // Periodic log
  if (unitState.ticksRunning % 20 === 0 && unitState.ticksRunning > 0) {
    const remainingWP = unitState.waypoints.length - unitState.nextWaypointIndex
    addLog(
      unitState.ticksRunning,
      'tick',
      `pos=(${unitState.position.X},${unitState.position.Y}) ` +
      `wp=${unitState.nextWaypointIndex}/${unitState.waypoints.length} ` +
      `remaining=${remainingWP} dist=${unitState.totalDistanceTraveled}su`
    )
  }

  if (!wasActive) {
    // Final update of visited line
    drawVisitedLine(unitState.visitedPositions)
    addLog(unitState.ticksRunning, 'state', `Movement complete — total distance=${unitState.totalDistanceTraveled}su`)
  }

  updateDiagnostics()
}

// ---------------------------------------------------------------------------
// Trail System
// ---------------------------------------------------------------------------

const MAX_TRAIL_DOTS = 200 // MAJOR fix: cap trail dot accumulation
function addTrailDot(pos: WPos, t: number): void {
  if (trailDots.length >= MAX_TRAIL_DOTS) { trailDots[0]!.dispose(); trailDots.shift() }
  const v = wPosToVector3(pos.X, pos.Y, 0)
  const dot = MeshBuilder.CreateSphere('trail', { diameter: 0.08 }, scene)
  dot.position.set(v.x, v.y + 0.12, v.z)
  const idx = Math.min(TRAIL_GRADIENT_STEPS - 1, Math.floor(t * TRAIL_GRADIENT_STEPS))
  dot.material = trailMaterials[idx]
  trailDots.push(dot)
}

function clearTrailDots(): void {
  for (const d of trailDots) d.dispose()
  trailDots.length = 0
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

function resetSimulation(): void {
  unitState.active = false
  unitState.atDestination = false
  unitMesh.visibility = 0
  facingLine.visibility = 0
  sourceMarker.visibility = 0
  destinationMarker.visibility = 0
  clearPathVisualization()
  clearTrailDots()
  renderObstacles(false)
  unitState = createDefaultUnitState()
  logEntries.length = 0
  renderLog()
  frameCounter = 0
}

// ---------------------------------------------------------------------------
// Event Log
// ---------------------------------------------------------------------------

interface LogEntry {
  tick: number
  mode: string
  text: string
}

const logEntries: LogEntry[] = []

function addLog(tick: number, mode: string, text: string): void {
  logEntries.push({ tick, mode, text })
  renderLog()
}

function renderLog(): void {
  const el = document.getElementById('event-log')!
  const recent = logEntries.slice(-30)
  el.innerHTML = recent.length === 0
    ? '<div class="log-row log-info">Ready. Select a scenario and click Start.</div>'
    : recent.map(e =>
      `<div class="log-row">
        <span class="log-tick">T${e.tick.toString().padStart(3, '0')}</span>
        <span class="log-${e.mode}">[${e.mode}]</span> ${e.text}
      </div>`
    ).join('')
  el.scrollTop = el.scrollHeight
}

// ---------------------------------------------------------------------------
// Diagnostics Panel
// ---------------------------------------------------------------------------

function updateDiagnostics(): void {
  if (!unitState.active && !unitState.atDestination) {
    document.getElementById('diag-state')!.textContent = 'idle'
    document.getElementById('diag-pos')!.textContent = '-'
    document.getElementById('diag-speed')!.textContent = '-'
    document.getElementById('diag-facing')!.textContent = '-'
    document.getElementById('diag-wp')!.textContent = '-'
    document.getElementById('diag-dist')!.textContent = '-'
    document.getElementById('diag-remaining')!.textContent = '-'
    document.getElementById('diag-ticks')!.textContent = '-'
    return
  }

  document.getElementById('diag-state')!.textContent =
    unitState.atDestination ? 'DESTINATION REACHED' : unitState.paused ? 'PAUSED' : 'MOVING'

  document.getElementById('diag-pos')!.textContent =
    `(${unitState.position.X}, ${unitState.position.Y})`

  document.getElementById('diag-speed')!.textContent =
    `${unitState.speed} su/tick (${(unitState.speed / 1024).toFixed(2)} cells/tick)`

  document.getElementById('diag-facing')!.textContent =
    `${unitState.facing.angle} (${(unitState.facing.angle * 360 / 256).toFixed(0)}°)`

  document.getElementById('diag-wp')!.textContent =
    unitState.waypoints.length > 0
      ? `${unitState.nextWaypointIndex}/${unitState.waypoints.length}`
      : '-'

  document.getElementById('diag-dist')!.textContent =
    `${unitState.totalDistanceTraveled} su`

  if (unitState.waypoints.length > 0 && !unitState.atDestination) {
    const wp = unitState.waypoints[unitState.nextWaypointIndex]
    if (wp) {
      const d = WPos.subtract(wp.wPos, unitState.position).horizontalLength
      document.getElementById('diag-remaining')!.textContent = `${d} su`
    } else {
      const d = WPos.subtract(unitState.destPos, unitState.position).horizontalLength
      document.getElementById('diag-remaining')!.textContent = `${d} su`
    }
  } else if (unitState.atDestination) {
    document.getElementById('diag-remaining')!.textContent = '0 su (arrived)'
  } else {
    document.getElementById('diag-remaining')!.textContent = '-'
  }

  document.getElementById('diag-ticks')!.textContent = `${unitState.ticksRunning}`
}

// ---------------------------------------------------------------------------
// Render Loop
// ---------------------------------------------------------------------------

engine.runRenderLoop(() => {
  frameCounter++
  if (frameCounter >= SIM_TICK_INTERVAL) {
    frameCounter = 0
    simulateTick()
  }
  scene.render()
  updateInfoBar()
})

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

const resizeHandler = () => { engine.resize() }
window.addEventListener('resize', resizeHandler)
// MAJOR fix: dispose engine on unload
window.addEventListener('beforeunload', () => { engine.dispose() })

// ---------------------------------------------------------------------------
// Button Handlers & Scenario Setup
// ---------------------------------------------------------------------------

/** Speed slider and display. */
const speedSlider = document.getElementById('speed-slider') as HTMLInputElement
const speedDisplay = document.getElementById('speed-display')!
const speedCellsDisplay = document.getElementById('speed-cells')!

function updateSpeedFromSlider(): void {
  const suPerTick = parseInt(speedSlider.value, 10)
  unitState.speed = suPerTick
  speedDisplay.textContent = `${suPerTick} su/tick`
  speedCellsDisplay.textContent = `${(suPerTick / 1024).toFixed(2)} cells/tick`
}

speedSlider.addEventListener('input', updateSpeedFromSlider)
updateSpeedFromSlider() // initial

// Scenario: Straight (clean grid, direct path)
document.getElementById('btn-straight')!.addEventListener('click', () => {
  setActiveScenario('straight')
  updateSpeedFromSlider()
  startMovement({ col: 2, row: 2 }, { col: 17, row: 2 }, false)
})

// Scenario: Diagonal (clean grid)
document.getElementById('btn-diagonal')!.addEventListener('click', () => {
  setActiveScenario('diagonal')
  updateSpeedFromSlider()
  startMovement({ col: 2, row: 2 }, { col: 17, row: 17 }, false)
})

// Scenario: Obstacle (wall in the middle, path must go around)
document.getElementById('btn-obstacle')!.addEventListener('click', () => {
  setActiveScenario('obstacle')
  updateSpeedFromSlider()
  startMovement({ col: 2, row: 5 }, { col: 17, row: 14 }, true)
})

// Scenario: Long (far corners)
document.getElementById('btn-long')!.addEventListener('click', () => {
  setActiveScenario('long')
  updateSpeedFromSlider()
  startMovement({ col: 1, row: 1 }, { col: 18, row: 18 }, false)
})

// Pause/Resume toggle
document.getElementById('btn-pause')!.addEventListener('click', () => {
  if (!unitState.active || unitState.atDestination) return
  unitState.paused = !unitState.paused
  const btn = document.getElementById('btn-pause')!
  btn.textContent = unitState.paused ? 'Resume' : 'Pause'
  addLog(unitState.ticksRunning, 'state', unitState.paused ? 'PAUSED' : 'RESUMED')
})

// Reset
document.getElementById('btn-reset')!.addEventListener('click', () => {
  resetSimulation()
  document.querySelectorAll('.scenario-btn').forEach(b => b.classList.remove('active-mode'))
  const pauseBtn = document.getElementById('btn-pause')!
  pauseBtn.textContent = 'Pause'
  updateDiagnostics()
})

function setActiveScenario(name: string): void {
  document.querySelectorAll('.scenario-btn').forEach(b => b.classList.remove('active-mode'))
  const btn = document.querySelector(`.scenario-btn[data-scenario="${name}"]`)
  if (btn) btn.classList.add('active-mode')
}

// ---------------------------------------------------------------------------
// Test Harness — exposed on window for Playwright programmatic verification
// ---------------------------------------------------------------------------

;(window as any).__testHarness = {
  scene,
  engine,

  /** Start unit movement to a destination (Babylon world coords). */
  moveUnit(_unitId: string, destination: { x: number; y: number; z: number }): void {
    const wp = new WPos(
      Math.round(destination.x / WORLD_SCALE),
      Math.round(destination.z / WORLD_SCALE),
      Math.round(destination.y / HEIGHT_SCALE),
    )
    const grid = wPosToGrid(wp)
    const currentGrid = unitState.active
      ? wPosToGrid(unitState.position)
      : { col: 2, row: 2 }
    startMovement(currentGrid, grid, unitState.obstacleMode)
  },

  /** Get current unit position in Babylon world coordinates. */
  getUnitPosition(): { x: number; y: number; z: number } | null {
    if (!unitState.active && !unitState.atDestination) return null
    return {
      x: unitState.position.X * WORLD_SCALE,
      y: unitState.position.Z * HEIGHT_SCALE,
      z: unitState.position.Y * WORLD_SCALE,
    }
  },

  /** Get current speed in su/tick. */
  getUnitSpeed(): number {
    return unitState.speed
  },

  /** Get path waypoints as Babylon world positions. */
  getPathWaypoints(): { x: number; y: number; z: number }[] {
    return unitState.waypoints.map(w => ({
      x: w.wPos.X * WORLD_SCALE,
      y: w.wPos.Z * HEIGHT_SCALE,
      z: w.wPos.Y * WORLD_SCALE,
    }))
  },

  /** Whether the unit has reached its destination. */
  isAtDestination(): boolean {
    return unitState.atDestination
  },

  /** Get movement progress as a fraction [0, 1]. */
  getProgress(): number {
    if (unitState.waypoints.length < 2) return 0
    return Math.min(1, unitState.nextWaypointIndex / unitState.waypoints.length)
  },

  /** Get total distance traveled in su. */
  getDistanceTraveled(): number {
    return unitState.totalDistanceTraveled
  },

  /** Get simulation ticks elapsed. */
  getTicksElapsed(): number {
    return unitState.ticksRunning
  },

  /** Get distance to current next waypoint in su. */
  getDistanceToNextWaypoint(): number {
    if (!unitState.active || unitState.atDestination) return 0
    const wp = unitState.waypoints[unitState.nextWaypointIndex]
    if (!wp) return 0
    return WPos.subtract(wp.wPos, unitState.position).horizontalLength
  },

  /** Get the event log. */
  getEventLog(): LogEntry[] {
    return [...logEntries]
  },

  /** Reset the test scene. */
  reset(): void {
    resetSimulation()
    document.querySelectorAll('.scenario-btn').forEach(b => b.classList.remove('active-mode'))
    const pauseBtn = document.getElementById('btn-pause')!
    pauseBtn.textContent = 'Pause'
    updateDiagnostics()
  },
}
