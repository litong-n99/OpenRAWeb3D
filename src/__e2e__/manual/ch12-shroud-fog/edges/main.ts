/**
 * shroud/edges/main.ts — Shroud Edge Blending visual acceptance test
 *
 * Verifies:
 * 1. Edge detection using 8-neighbor visibility check (OpenRA's Edges enum)
 * 2. Smooth gradient strips at boundaries between different visibility states
 * 3. No edge sprites on cells surrounded by same-state neighbors
 * 4. Edge pattern updates correctly when visibility area expands/contracts
 *
 * Architecture mirrors ShroudRenderer._getCellEdges():
 *   - Edges bitflags: TopLeft(0x01), TopRight(0x02), BottomRight(0x04), BottomLeft(0x08),
 *     TopSide(0x10), RightSide(0x20), BottomSide(0x40), LeftSide(0x80)
 *   - 8-neighbor array: [Top, Right, Bottom, Left, TopLeft, TopRight, BottomRight, BottomLeft]
 *   - Canvas2D overlay with per-edge gradient strips
 */

import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  Vector3,
  Color4,
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  Color3,
  PointerEventTypes,
  type AbstractMesh,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Grid Configuration
// ---------------------------------------------------------------------------

const GRID_WIDTH = 12
const GRID_HEIGHT = 12
const CELL_SIZE = 0.6
const TOTAL_CELLS = GRID_WIDTH * GRID_HEIGHT
const GRID_WORLD_W = GRID_WIDTH * CELL_SIZE
const GRID_WORLD_H = GRID_HEIGHT * CELL_SIZE

const TEX_RES = 600
const CELL_PX = TEX_RES / GRID_WIDTH // 50px per cell

const EDGE_GRADIENT_PX = 4
const EDGE_HALF = EDGE_GRADIENT_PX / 2

// ---------------------------------------------------------------------------
// Visibility States
// ---------------------------------------------------------------------------

const HIDDEN = 0
const EXPLORED = 1
const VISIBLE = 2

// ---------------------------------------------------------------------------
// Edges bitflags (matching ShroudRenderer.Edges)
// ---------------------------------------------------------------------------

const Edges = {
  None: 0,
  TopLeft: 0x01,
  TopRight: 0x02,
  BottomRight: 0x04,
  BottomLeft: 0x08,
  AllCorners: 0x0f,
  TopSide: 0x10,
  RightSide: 0x20,
  BottomSide: 0x40,
  LeftSide: 0x80,
} as const

/** Neighbor indices for 8-direction array. */
const Neighbor = {
  Top: 0,
  Right: 1,
  Bottom: 2,
  Left: 3,
  TopLeft: 4,
  TopRight: 5,
  BottomRight: 6,
  BottomLeft: 7,
} as const

/** 8-direction offsets as [col, row] pairs. */
const ALL_DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, -1],  // Top
  [1, 0],   // Right
  [0, 1],   // Bottom
  [-1, 0],  // Left
  [-1, -1], // TopLeft
  [1, -1],  // TopRight
  [1, 1],   // BottomRight
  [-1, 1],  // BottomLeft
]

// ---------------------------------------------------------------------------
// Visibility Data
// ---------------------------------------------------------------------------

const visibilityData = new Uint8Array(TOTAL_CELLS)
visibilityData.fill(HIDDEN)

let anyCellDirty = true

function cellIndex(col: number, row: number): number {
  return row * GRID_WIDTH + col
}

function isValidCell(col: number, row: number): boolean {
  return col >= 0 && col < GRID_WIDTH && row >= 0 && row < GRID_HEIGHT
}

// ---------------------------------------------------------------------------
// State → Color
// ---------------------------------------------------------------------------

interface CellRGBA {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

function stateToRGBA(state: number): CellRGBA {
  switch (state) {
    case HIDDEN:  return { r: 0, g: 0, b: 0, a: 1.0 }
    case EXPLORED: return { r: 15, g: 15, b: 15, a: 0.55 }
    case VISIBLE:  return { r: 0, g: 0, b: 0, a: 0.0 }
    default:       return { r: 0, g: 0, b: 0, a: 1.0 }
  }
}

function rgbaToCSS(c: CellRGBA): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`
}

function stateName(state: number): string {
  switch (state) {
    case HIDDEN:  return 'Hidden'
    case EXPLORED: return 'Explored'
    case VISIBLE:  return 'Visible'
    default:       return 'Unknown'
  }
}

// ---------------------------------------------------------------------------
// 8-Neighbor Visibility Query
// ---------------------------------------------------------------------------

function getNeighbors(col: number, row: number): Uint8Array {
  const neighbors = new Uint8Array(8)
  for (let i = 0; i < 8; i++) {
    const nc = col + ALL_DIRECTIONS[i][0]
    const nr = row + ALL_DIRECTIONS[i][1]
    if (isValidCell(nc, nr)) {
      neighbors[i] = visibilityData[cellIndex(nc, nr)]
    } else {
      neighbors[i] = HIDDEN // out-of-bounds = hidden
    }
  }
  return neighbors
}

// ---------------------------------------------------------------------------
// Edge Computation (matching ShroudRenderer._getEdges)
// ---------------------------------------------------------------------------

function computeEdges(neighbors: Uint8Array, cellState: number): number {
  let edges = Edges.None

  // Check sides
  if (neighbors[Neighbor.Top] !== cellState) {
    edges |= Edges.TopSide | Edges.TopLeft | Edges.TopRight
  }
  if (neighbors[Neighbor.Right] !== cellState) {
    edges |= Edges.RightSide | Edges.TopRight | Edges.BottomRight
  }
  if (neighbors[Neighbor.Bottom] !== cellState) {
    edges |= Edges.BottomSide | Edges.BottomRight | Edges.BottomLeft
  }
  if (neighbors[Neighbor.Left] !== cellState) {
    edges |= Edges.LeftSide | Edges.TopLeft | Edges.BottomLeft
  }

  // Corner checks
  if (neighbors[Neighbor.TopLeft] !== cellState) {
    edges |= Edges.TopLeft
  }
  if (neighbors[Neighbor.TopRight] !== cellState) {
    edges |= Edges.TopRight
  }
  if (neighbors[Neighbor.BottomRight] !== cellState) {
    edges |= Edges.BottomRight
  }
  if (neighbors[Neighbor.BottomLeft] !== cellState) {
    edges |= Edges.BottomLeft
  }

  return edges
}

function getCellEdges(col: number, row: number): [number, number] {
  const idx = cellIndex(col, row)
  const cv = visibilityData[idx]

  if (cv === HIDDEN) {
    return [Edges.AllCorners, Edges.AllCorners]
  }

  const neighbors = getNeighbors(col, row)

  // Fog edges: always AllCorners for non-Visible cells (simplified)
  const fogEdges =
    cv === VISIBLE ? computeEdges(neighbors, cv) : Edges.AllCorners

  // Shroud edges
  const shroudEdges = computeEdges(neighbors, cv)

  return [shroudEdges, fogEdges]
}

// ---------------------------------------------------------------------------
// Edge Bit to Name
// ---------------------------------------------------------------------------

function edgeFlagsToNames(flags: number): string {
  const parts: string[] = []
  if (flags & Edges.TopLeft) parts.push('TL')
  if (flags & Edges.TopRight) parts.push('TR')
  if (flags & Edges.BottomRight) parts.push('BR')
  if (flags & Edges.BottomLeft) parts.push('BL')
  if (flags & Edges.TopSide) parts.push('TS')
  if (flags & Edges.RightSide) parts.push('RS')
  if (flags & Edges.BottomSide) parts.push('BS')
  if (flags & Edges.LeftSide) parts.push('LS')
  return parts.length > 0 ? parts.join('|') : 'None'
}

// ---------------------------------------------------------------------------
// Canvas2D Shroud Overlay with Edge Blending
// ---------------------------------------------------------------------------

let dynamicTexture: DynamicTexture | null = null

/**
 * Draw shroud overlay with edge blending.
 *
 * Phase 1: Fill all cells with solid base color.
 * Phase 2: For each boundary between different states, draw a 4px gradient strip.
 * Phase 3: For fully internal cells (all neighbors same state), ensure no edge artifacts.
 */
function drawShroudOverlay(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, TEX_RES, TEX_RES)

  // --- Phase 1: Base cell rendering ---
  for (let row = 0; row < GRID_HEIGHT; row++) {
    for (let col = 0; col < GRID_WIDTH; col++) {
      const idx = cellIndex(col, row)
      const state = visibilityData[idx]
      if (state === VISIBLE) continue

      const px = col * CELL_PX
      const py = row * CELL_PX
      const c = stateToRGBA(state)
      ctx.fillStyle = rgbaToCSS(c)
      ctx.fillRect(px, py, CELL_PX, CELL_PX)
    }
  }

  // --- Phase 2: Edge blending gradients ---
  for (let row = 0; row < GRID_HEIGHT; row++) {
    for (let col = 0; col < GRID_WIDTH; col++) {
      const state = visibilityData[cellIndex(col, row)]
      if (state === VISIBLE) continue // transparent cell — edge blends handled from neighbor

      // Horizontal edge (right neighbor)
      if (col + 1 < GRID_WIDTH) {
        const rightState = visibilityData[cellIndex(col + 1, row)]
        if (state !== rightState && rightState !== VISIBLE) {
          const gx = (col + 1) * CELL_PX - EDGE_HALF
          const gy = row * CELL_PX
          const leftRGBA = stateToRGBA(state)
          const rightRGBA = stateToRGBA(rightState)
          const grad = ctx.createLinearGradient(gx, 0, gx + EDGE_GRADIENT_PX, 0)
          grad.addColorStop(0, rgbaToCSS(leftRGBA))
          grad.addColorStop(1, rgbaToCSS(rightRGBA))
          ctx.fillStyle = grad
          ctx.fillRect(gx, gy, EDGE_GRADIENT_PX, CELL_PX)
        } else if (state !== rightState) {
          // rightState is VISIBLE — gradient from solid to transparent
          const gx = (col + 1) * CELL_PX - EDGE_HALF
          const gy = row * CELL_PX
          const leftRGBA = stateToRGBA(state)
          const rightRGBA: CellRGBA = { r: 0, g: 0, b: 0, a: 0 }
          const grad = ctx.createLinearGradient(gx, 0, gx + EDGE_GRADIENT_PX, 0)
          grad.addColorStop(0, rgbaToCSS(leftRGBA))
          grad.addColorStop(1, rgbaToCSS(rightRGBA))
          ctx.fillStyle = grad
          ctx.fillRect(gx, gy, EDGE_GRADIENT_PX, CELL_PX)
        }
      }

      // Vertical edge (bottom neighbor)
      if (row + 1 < GRID_HEIGHT) {
        const bottomState = visibilityData[cellIndex(col, row + 1)]
        if (state !== bottomState && bottomState !== VISIBLE) {
          const gx = col * CELL_PX
          const gy = (row + 1) * CELL_PX - EDGE_HALF
          const topRGBA = stateToRGBA(state)
          const bottomRGBA = stateToRGBA(bottomState)
          const grad = ctx.createLinearGradient(0, gy, 0, gy + EDGE_GRADIENT_PX)
          grad.addColorStop(0, rgbaToCSS(topRGBA))
          grad.addColorStop(1, rgbaToCSS(bottomRGBA))
          ctx.fillStyle = grad
          ctx.fillRect(gx, gy, CELL_PX, EDGE_GRADIENT_PX)
        } else if (state !== bottomState) {
          // bottomState is VISIBLE — gradient from solid to transparent
          const gx = col * CELL_PX
          const gy = (row + 1) * CELL_PX - EDGE_HALF
          const topRGBA = stateToRGBA(state)
          const bottomRGBA: CellRGBA = { r: 0, g: 0, b: 0, a: 0 }
          const grad = ctx.createLinearGradient(0, gy, 0, gy + EDGE_GRADIENT_PX)
          grad.addColorStop(0, rgbaToCSS(topRGBA))
          grad.addColorStop(1, rgbaToCSS(bottomRGBA))
          ctx.fillStyle = grad
          ctx.fillRect(gx, gy, CELL_PX, EDGE_GRADIENT_PX)
        }
      }
    }
  }

  // --- Phase 3: Draw edge highlight overlay (semi-transparent lines showing computed edges) ---
  // Draw thin colored lines at cell boundaries where edge flags are set
  for (let row = 0; row < GRID_HEIGHT; row++) {
    for (let col = 0; col < GRID_WIDTH; col++) {
      const idx = cellIndex(col, row)
      const state = visibilityData[idx]
      if (state === HIDDEN) continue

      const [shroudEdges] = getCellEdges(col, row)
      if (shroudEdges === Edges.None) continue

      const cx = col * CELL_PX + CELL_PX / 2
      const cy = row * CELL_PX + CELL_PX / 2
      const half = CELL_PX / 2

      ctx.strokeStyle = 'rgba(255,255,0,0.5)'
      ctx.lineWidth = 1.5

      if (shroudEdges & Edges.TopLeft) {
        ctx.beginPath()
        ctx.moveTo(cx - half, cy - half)
        ctx.lineTo(cx, cy - half)
        ctx.lineTo(cx - half, cy)
        ctx.stroke()
      }
      if (shroudEdges & Edges.TopRight) {
        ctx.beginPath()
        ctx.moveTo(cx + half, cy - half)
        ctx.lineTo(cx, cy - half)
        ctx.lineTo(cx + half, cy)
        ctx.stroke()
      }
      if (shroudEdges & Edges.BottomRight) {
        ctx.beginPath()
        ctx.moveTo(cx + half, cy + half)
        ctx.lineTo(cx, cy + half)
        ctx.lineTo(cx + half, cy)
        ctx.stroke()
      }
      if (shroudEdges & Edges.BottomLeft) {
        ctx.beginPath()
        ctx.moveTo(cx - half, cy + half)
        ctx.lineTo(cx, cy + half)
        ctx.lineTo(cx - half, cy)
        ctx.stroke()
      }
    }
  }
}

function updateShroudTexture(): void {
  if (!anyCellDirty || !dynamicTexture) return
  const ctx = dynamicTexture.getContext() as CanvasRenderingContext2D
  drawShroudOverlay(ctx)
  dynamicTexture.update(false)
  anyCellDirty = false
}

// ---------------------------------------------------------------------------
// Preset Patterns
// ---------------------------------------------------------------------------

/** Checkerboard pattern: alternating Visible and Explored cells. */
function presetCheckerboard(): void {
  for (let row = 0; row < GRID_HEIGHT; row++) {
    for (let col = 0; col < GRID_WIDTH; col++) {
      visibilityData[cellIndex(col, row)] = (row + col) % 2 === 0 ? VISIBLE : EXPLORED
    }
  }
  anyCellDirty = true
  updateShroudTexture()
}

/** Island pattern: central visible island, explored ring, hidden outer. */
function presetIsland(): void {
  const cx = Math.floor(GRID_WIDTH / 2)
  const cy = Math.floor(GRID_HEIGHT / 2)
  const visR = 2
  const expR = 4

  for (let row = 0; row < GRID_HEIGHT; row++) {
    for (let col = 0; col < GRID_WIDTH; col++) {
      const dx = col - cx
      const dy = row - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      let state: number
      if (dist <= visR) state = VISIBLE
      else if (dist <= expR) state = EXPLORED
      else state = HIDDEN
      visibilityData[cellIndex(col, row)] = state
    }
  }
  anyCellDirty = true
  updateShroudTexture()
}

/** Diagonal pattern: visible top-left triangle, explored middle band, hidden bottom-right. */
function presetDiagonal(): void {
  for (let row = 0; row < GRID_HEIGHT; row++) {
    for (let col = 0; col < GRID_WIDTH; col++) {
      const idx = cellIndex(col, row)
      const sum = row + col
      if (sum < 8) visibilityData[idx] = VISIBLE
      else if (sum < 16) visibilityData[idx] = EXPLORED
      else visibilityData[idx] = HIDDEN
    }
  }
  anyCellDirty = true
  updateShroudTexture()
}

/** Expand visible area by flipping the outermost Visible-neighbor HIDDEN/EXPLORED cells. */
function expandVisible(): void {
  const newData = new Uint8Array(visibilityData)
  for (let row = 0; row < GRID_HEIGHT; row++) {
    for (let col = 0; col < GRID_WIDTH; col++) {
      const idx = cellIndex(col, row)
      if (visibilityData[idx] === VISIBLE) continue
      // Check if any neighbor is VISIBLE
      const neighbors = getNeighbors(col, row)
      let hasVisibleNeighbor = false
      for (let i = 0; i < 8; i++) {
        if (neighbors[i] === VISIBLE) {
          hasVisibleNeighbor = true
          break
        }
      }
      if (hasVisibleNeighbor) {
        // Promote: HIDDEN → EXPLORED, EXPLORED → VISIBLE
        if (visibilityData[idx] === HIDDEN) newData[idx] = EXPLORED
        else if (visibilityData[idx] === EXPLORED) newData[idx] = VISIBLE
      }
    }
  }
  for (let i = 0; i < TOTAL_CELLS; i++) {
    visibilityData[i] = newData[i]
  }
  anyCellDirty = true
  updateShroudTexture()
}

/**
 * Shrink visible area by degrading outermost VISIBLE cells to EXPLORED, and EXPLORED to HIDDEN.
 *
 * Degradation rules:
 * - VISIBLE(2): if any neighbor has state < 2 (EXPLORED or HIDDEN) → degrade to EXPLORED(1)
 * - EXPLORED(1): if any neighbor has state > 1 (VISIBLE) → degrade to HIDDEN(0)
 */
function shrinkVisible(): void {
  const newData = new Uint8Array(visibilityData)
  for (let row = 0; row < GRID_HEIGHT; row++) {
    for (let col = 0; col < GRID_WIDTH; col++) {
      const idx = cellIndex(col, row)
      if (visibilityData[idx] === HIDDEN) continue

      const neighbors = getNeighbors(col, row)

      if (visibilityData[idx] === VISIBLE) {
        // VISIBLE → EXPLORED: check if any neighbor has lower state (< 2)
        let hasLowerNeighbor = false
        for (let i = 0; i < 8; i++) {
          if (neighbors[i] < VISIBLE) {
            hasLowerNeighbor = true
            break
          }
        }
        if (hasLowerNeighbor) {
          newData[idx] = EXPLORED
        }
      } else if (visibilityData[idx] === EXPLORED) {
        // EXPLORED → HIDDEN: keep existing logic (check for higher neighbor)
        let allNeighborsSameOrHigher = true
        for (let i = 0; i < 8; i++) {
          if (neighbors[i] > EXPLORED) {
            allNeighborsSameOrHigher = false
            break
          }
        }
        if (!allNeighborsSameOrHigher) {
          newData[idx] = HIDDEN
        }
      }
    }
  }
  for (let i = 0; i < TOTAL_CELLS; i++) {
    visibilityData[i] = newData[i]
  }
  anyCellDirty = true
  updateShroudTexture()
}

// ---------------------------------------------------------------------------
// Cell Inspector
// ---------------------------------------------------------------------------

function updateCellInspector(col: number, row: number): void {
  const coordEl = document.getElementById('insp-coord')!
  const stateEl = document.getElementById('insp-state')!
  const edgesEl = document.getElementById('insp-edges')!
  const cornersEl = document.getElementById('insp-corners')!

  if (!isValidCell(col, row)) {
    coordEl.textContent = '-'
    stateEl.textContent = '-'
    edgesEl.textContent = '-'
    cornersEl.textContent = '-'
    return
  }

  const idx = cellIndex(col, row)
  const state = visibilityData[idx]
  const [shroudEdges] = getCellEdges(col, row)

  coordEl.textContent = `(${col}, ${row})`
  stateEl.textContent = `${state} (${stateName(state)})`
  edgesEl.textContent = `0x${shroudEdges.toString(16).padStart(2, '0')} = ${edgeFlagsToNames(shroudEdges)}`
  cornersEl.textContent = (shroudEdges & Edges.AllCorners) === 0
    ? '全同状态(无边缘)'
    : `${(shroudEdges & 0x0f).toString(2).padStart(4,'0')}b (TL|TR|BR|BL)`
}

// ---------------------------------------------------------------------------
// Info Bar
// ---------------------------------------------------------------------------

const infoUa = document.getElementById('info-ua')!
const infoViewport = document.getElementById('info-viewport')!
const infoEngine = document.getElementById('info-engine')!
const infoHidden = document.getElementById('info-hidden')!
const infoExplored = document.getElementById('info-explored')!
const infoVisible = document.getElementById('info-visible')!
const infoFps = document.getElementById('info-fps')!
const infoTime = document.getElementById('info-time')!

function countStates(): { hidden: number; explored: number; visible: number } {
  let hidden = 0, explored = 0, visible = 0
  for (let i = 0; i < TOTAL_CELLS; i++) {
    switch (visibilityData[i]) {
      case HIDDEN: hidden++; break
      case EXPLORED: explored++; break
      case VISIBLE: visible++; break
    }
  }
  return { hidden, explored, visible }
}

function updateInfoBar(engine: Engine): void {
  infoUa.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  infoViewport.textContent = `${window.innerWidth}x${window.innerHeight}`
  infoEngine.textContent = engine.webGLVersion === 2 ? 'WebGL 2.0' : 'WebGL 1.0'
  const counts = countStates()
  infoHidden.textContent = String(counts.hidden)
  infoExplored.textContent = String(counts.explored)
  infoVisible.textContent = String(counts.visible)
  infoFps.textContent = String(Math.round(engine.getFps()))
  infoTime.textContent = new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Babylon.js Scene Setup
// ---------------------------------------------------------------------------

function setupScene(): { engine: Engine; scene: Scene; pickPlane: AbstractMesh } {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false })
  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.12, 0.14, 0.18, 1)

  const camera = new ArcRotateCamera(
    'camera',
    -Math.PI / 4, Math.PI / 3.5, 12,
    new Vector3(GRID_WORLD_W / 2, 0, GRID_WORLD_H / 2),
    scene,
  )
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 2
  camera.upperRadiusLimit = 30
  camera.panningSensibility = 50

  new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)

  // Terrain plane with checkerboard
  const terrainTexRes = 600
  const terrainTex = new DynamicTexture('terrainTex', { width: terrainTexRes, height: terrainTexRes / 2 }, scene, false)
  const tctx = terrainTex.getContext() as CanvasRenderingContext2D
  const checkerCols = 8, checkerRows = 4
  const checkerW = terrainTexRes / checkerCols, checkerH = (terrainTexRes / 2) / checkerRows
  for (let row = 0; row < checkerRows; row++) {
    for (let col = 0; col < checkerCols; col++) {
      tctx.fillStyle = (row + col) % 2 === 0 ? '#1a5c1a' : '#2a7c2a'
      tctx.fillRect(col * checkerW, row * checkerH, checkerW, checkerH)
    }
  }
  tctx.strokeStyle = '#0d3d0d'
  tctx.lineWidth = 1
  for (let i = 0; i <= checkerCols; i++) { tctx.beginPath(); tctx.moveTo(i * checkerW, 0); tctx.lineTo(i * checkerW, terrainTexRes / 2); tctx.stroke() }
  for (let i = 0; i <= checkerRows; i++) { tctx.beginPath(); tctx.moveTo(0, i * checkerH); tctx.lineTo(terrainTexRes, i * checkerH); tctx.stroke() }
  terrainTex.update(false)

  const terrainMat = new StandardMaterial('terrainMat', scene)
  terrainMat.diffuseTexture = terrainTex
  terrainMat.specularColor = new Color3(0.05, 0.05, 0.05)

  const terrainPlane = MeshBuilder.CreateGround('terrainPlane', { width: GRID_WORLD_W, height: GRID_WORLD_H, subdivisions: 1 }, scene)
  terrainPlane.position = new Vector3(GRID_WORLD_W / 2, -0.005, GRID_WORLD_H / 2)
  terrainPlane.material = terrainMat

  // Shroud overlay
  dynamicTexture = new DynamicTexture('shroudTex', { width: TEX_RES, height: TEX_RES }, scene, false)
  const sctx = dynamicTexture.getContext() as CanvasRenderingContext2D
  drawShroudOverlay(sctx)
  dynamicTexture.update(false)

  const shroudMat = new StandardMaterial('shroudMat', scene)
  shroudMat.diffuseTexture = dynamicTexture
  shroudMat.specularColor = new Color3(0, 0, 0)
  shroudMat.useAlphaFromDiffuseTexture = true
  shroudMat.backFaceCulling = false

  const shroudPlane = MeshBuilder.CreateGround('shroudPlane', { width: GRID_WORLD_W, height: GRID_WORLD_H, subdivisions: 1 }, scene)
  shroudPlane.position = new Vector3(GRID_WORLD_W / 2, 0.0, GRID_WORLD_H / 2)
  shroudPlane.material = shroudMat

  return { engine, scene, pickPlane: shroudPlane }
}

// ---------------------------------------------------------------------------
// Mouse Interaction
// ---------------------------------------------------------------------------

function setupInteraction(scene: Scene, pickPlane: AbstractMesh, engine: Engine): void {
  function screenToGrid(px: number, py: number): { col: number; row: number } | null {
    const pick = scene.pick(px, py, (mesh) => mesh === pickPlane)
    if (!pick || !pick.pickedPoint) return null
    const col = Math.floor(pick.pickedPoint.x / CELL_SIZE)
    const row = Math.floor(pick.pickedPoint.z / CELL_SIZE)
    if (!isValidCell(col, row)) return null
    return { col, row }
  }

  scene.onPointerObservable.add((_pointerInfo) => {
    const grid = screenToGrid(scene.pointerX, scene.pointerY)
    if (grid) updateCellInspector(grid.col, grid.row)
    else updateCellInspector(-1, -1)
  }, PointerEventTypes.POINTERMOVE)

  const canvas = engine.getRenderingCanvas()
  canvas?.addEventListener('contextmenu', (e) => { e.preventDefault() })
}

// ---------------------------------------------------------------------------
// UI Controls
// ---------------------------------------------------------------------------

function setupControls(): void {
  document.getElementById('btn-checkerboard')!.addEventListener('click', presetCheckerboard)
  document.getElementById('btn-island')!.addEventListener('click', presetIsland)
  document.getElementById('btn-diagonal')!.addEventListener('click', presetDiagonal)

  let expandCount = 0
  document.getElementById('btn-expand')!.addEventListener('click', () => {
    const steps = parseInt((document.getElementById('range-steps') as HTMLInputElement).value, 10)
    for (let i = 0; i < steps; i++) expandVisible()
    expandCount++
    ;(document.getElementById('btn-expand') as HTMLElement).textContent = `扩张可见区域 (${expandCount})`
  })
  document.getElementById('btn-shrink')!.addEventListener('click', () => {
    const steps = parseInt((document.getElementById('range-steps') as HTMLInputElement).value, 10)
    for (let i = 0; i < steps; i++) shrinkVisible()
    expandCount = Math.max(0, expandCount - 1)
    ;(document.getElementById('btn-expand') as HTMLElement).textContent = `扩张可见区域 (${expandCount})`
  })

  const rangeSteps = document.getElementById('range-steps') as HTMLInputElement
  const valSteps = document.getElementById('val-steps')!
  rangeSteps.addEventListener('input', () => { valSteps.textContent = rangeSteps.value })

  window.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'c': case 'C': presetCheckerboard(); break
      case 'i': case 'I': presetIsland(); break
      case 'd': case 'D': presetDiagonal(); break
      case 'e': case 'E': expandVisible(); break
      case 's': case 'S': shrinkVisible(); break
    }
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { engine, scene, pickPlane } = setupScene()
setupControls()
setupInteraction(scene, pickPlane, engine)

// Start with island preset for best edge visibility demo
presetIsland()

engine.runRenderLoop(() => {
  scene.render()
  updateInfoBar(engine)
})

window.addEventListener('resize', () => { engine.resize() })

;(window as unknown as Record<string, unknown>).__shroudEdgesTest = {
  visibilityData,
  engine,
  scene,
  getCellEdges,
  computeEdges,
  presetCheckerboard,
  presetIsland,
  presetDiagonal,
  expandVisible,
  shrinkVisible,
}
