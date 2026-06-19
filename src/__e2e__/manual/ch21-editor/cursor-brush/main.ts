/**
 * ch21-editor/cursor-brush/main.ts — Editor brush/cursor acceptance test
 *
 * Verifies:
 * 1. Brush NxN cell coverage highlight (1x1, 3x3, 5x5)
 * 2. Highlight color = blue 40% opacity (rgba(64,128,255,0.40))
 * 3. Path connection start→end via Bresenham supercover (8-directional)
 * 4. Tile type switching immediate effect
 * 5. Brush size boundary correctness
 *
 * Architecture:
 *   - Babylon.js 3D scene with top-down camera + grid texture
 *   - Canvas2D overlay for brush/path highlights
 *   - Mouse tracking for brush cursor
 *   - Bresenham supercover matches PathPlan.pointsWithRallyIndex algorithm
 *   - __testHarness exposed on window for automated verification
 *
 * OpenRA comparison:
 *   EditorCursorLayer: cursor cell position + brush mode coloring
 *   TilingPathTool.PathPlan: Bresenham supercover path interpolation
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
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Grid & world constants
// ---------------------------------------------------------------------------

/** Number of cells per side of the square grid. */
const GRID_CELLS = 20
/** World-space size of the grid (1 world unit = 1 cell). */
const GRID_SIZE = GRID_CELLS
/** Grid origin in world space (center-aligned). */
const GRID_ORIGIN_X = -GRID_SIZE / 2
const GRID_ORIGIN_Z = -GRID_SIZE / 2

// ---------------------------------------------------------------------------
// Brush highlight color
// ---------------------------------------------------------------------------

/** Brush highlight: semi-transparent blue, matching EditorCursorLayer actor mode. */
const BRUSH_COLOR = { r: 64, g: 128, b: 255, a: 0.40 }
/** Path highlight: semi-transparent orange. */
const PATH_COLOR = { r: 255, g: 180, b: 0, a: 0.55 }
/** Start marker color: green. */
const START_COLOR = { r: 0, g: 255, b: 80, a: 0.8 }
/** End marker color: red. */
const END_COLOR = { r: 255, g: 50, b: 50, a: 0.8 }

// ---------------------------------------------------------------------------
// Tile type definitions
// ---------------------------------------------------------------------------

interface TileDef {
  id: string
  label: string
  color: string
}

const TILE_TYPES: readonly TileDef[] = [
  { id: 'Sand', label: '沙地', color: '#e6c87a' },
  { id: 'Rock', label: '岩石', color: '#888888' },
  { id: 'Grass', label: '草地', color: '#4caf50' },
  { id: 'Water', label: '水域', color: '#42a5f5' },
  { id: 'Road', label: '道路', color: '#666666' },
  { id: 'Cliff', label: '悬崖', color: '#a0522d' },
]

const TILE_COLORS: Record<string, string> = {
  Sand: '#e6c87a',
  Rock: '#888888',
  Grass: '#4caf50',
  Water: '#42a5f5',
  Road: '#666666',
  Cliff: '#a0522d',
}

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------

/** Current brush size (N for NxN brush). */
let brushSize = 5
/** Currently selected tile type ID. */
let selectedTileType = 'Sand'
/** Current mouse cursor cell position, or null if outside grid. */
let cursorCell: { x: number; z: number } | null = null
/** Whether in path mode (vs brush mode). */
let pathMode = false
/** Path start cell, or null. */
let pathStart: { x: number; z: number } | null = null
/** Path end cell, or null. */
let pathEnd: { x: number; z: number } | null = null
/** Highlight opacity percentage (10-90). */
let highlightOpacity = 40

// ---------------------------------------------------------------------------
// Babylon.js references
// ---------------------------------------------------------------------------

let engine!: Engine
let scene!: Scene
let bjsCanvas!: HTMLCanvasElement

// ---------------------------------------------------------------------------
// Babylon.js Scene Setup
// ---------------------------------------------------------------------------

function setupScene(): void {
  bjsCanvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  engine = new Engine(bjsCanvas, true, {
    preserveDrawingBuffer: true,
    stencil: false,
  })
  scene = new Scene(engine)
  scene.clearColor = new Color4(0.12, 0.14, 0.18, 1)

  // Top-down camera, centered on the grid
  const camCenterX = GRID_ORIGIN_X + GRID_SIZE / 2
  const camCenterZ = GRID_ORIGIN_Z + GRID_SIZE / 2
  const camera = new ArcRotateCamera(
    'camera',
    -Math.PI / 2,
    0.01,
    16,
    new Vector3(camCenterX, 0, camCenterZ),
    scene,
  )
  camera.attachControl(bjsCanvas, true)
  camera.lowerRadiusLimit = 4
  camera.upperRadiusLimit = 40

  // Light
  const hemi = new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)
  hemi.intensity = 0.8

  // Grid texture
  const texRes = 1024
  const gridTex = new DynamicTexture('gridTex', { width: texRes, height: texRes }, scene, false)
  drawGridTexture(gridTex, texRes)

  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.diffuseTexture = gridTex
  groundMat.specularColor = new Color3(0, 0, 0)
  groundMat.backFaceCulling = false

  const ground = MeshBuilder.CreateGround(
    'ground',
    { width: GRID_SIZE, height: GRID_SIZE },
    scene,
  )
  ground.position.set(GRID_ORIGIN_X + GRID_SIZE / 2, -0.01, GRID_ORIGIN_Z + GRID_SIZE / 2)
  ground.receiveShadows = false
  ground.material = groundMat
}

/**
 * Draw the grid texture with cell boundaries, major grid lines, and
 * coordinate labels along the edges.
 */
function drawGridTexture(tex: DynamicTexture, res: number): void {
  const ctx = tex.getContext() as CanvasRenderingContext2D
  const cellPx = res / GRID_CELLS

  // Background
  ctx.fillStyle = '#1a2a1a'
  ctx.fillRect(0, 0, res, res)

  // Minor grid lines
  ctx.strokeStyle = '#253525'
  ctx.lineWidth = 0.5
  for (let i = 0; i <= GRID_CELLS; i++) {
    ctx.beginPath()
    ctx.moveTo(i * cellPx, 0)
    ctx.lineTo(i * cellPx, res)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, i * cellPx)
    ctx.lineTo(res, i * cellPx)
    ctx.stroke()
  }

  // Major grid lines (every 5 cells)
  ctx.strokeStyle = '#3a5a3a'
  ctx.lineWidth = 2
  for (let i = 0; i <= GRID_CELLS; i += 5) {
    ctx.beginPath()
    ctx.moveTo(i * cellPx, 0)
    ctx.lineTo(i * cellPx, res)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, i * cellPx)
    ctx.lineTo(res, i * cellPx)
    ctx.stroke()
  }

  // Coordinate labels
  ctx.fillStyle = '#667766'
  ctx.font = `${Math.max(8, cellPx * 0.35)}px monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let i = 0; i < GRID_CELLS; i++) {
    ctx.fillText(String(i), (i + 0.5) * cellPx, 6)
    ctx.fillText(String(i), 8, (i + 0.5) * cellPx)
  }

  tex.update(false)
}

// ---------------------------------------------------------------------------
// Canvas2D Overlay for highlights
// ---------------------------------------------------------------------------

let overlayCanvas: HTMLCanvasElement | null = null
let overlayCtx: CanvasRenderingContext2D | null = null

function setupOverlay(): void {
  overlayCanvas = document.createElement('canvas')
  overlayCanvas.id = 'overlayCanvas'
  overlayCanvas.style.position = 'absolute'
  overlayCanvas.style.top = '0'
  overlayCanvas.style.left = '0'
  overlayCanvas.style.width = '100%'
  overlayCanvas.style.height = '100%'
  overlayCanvas.style.pointerEvents = 'none'
  overlayCanvas.width = 0
  overlayCanvas.height = 0
  document.getElementById('sandbox')!.appendChild(overlayCanvas)
  overlayCtx = overlayCanvas.getContext('2d')!

  window.addEventListener('resize', resizeOverlay)
  resizeOverlay()
}

function resizeOverlay(): void {
  if (!overlayCanvas) return
  const rect = bjsCanvas.getBoundingClientRect()
  overlayCanvas.width = rect.width
  overlayCanvas.height = rect.height
  overlayCanvas.style.width = `${rect.width}px`
  overlayCanvas.style.height = `${rect.height}px`
}

// ---------------------------------------------------------------------------
// Coordinate conversions
// ---------------------------------------------------------------------------

/**
 * Convert a grid cell coordinate (x, z) to canvas pixel position.
 * Grid coordinates range [0, GRID_CELLS).
 */
function cellToCanvas(cx: number, cz: number): { px: number; py: number } | null {
  if (!overlayCanvas) return null
  const rect = bjsCanvas.getBoundingClientRect()
  const px = ((cx + 0.5) / GRID_CELLS) * rect.width
  const py = ((cz + 0.5) / GRID_CELLS) * rect.height
  return { px, py }
}

/**
 * Convert a cell to canvas rectangle (pixel coordinates of the cell bounds).
 */
function cellRect(cx: number, cz: number): { left: number; top: number; w: number; h: number } | null {
  if (!overlayCanvas) return null
  const rect = bjsCanvas.getBoundingClientRect()
  const cellW = rect.width / GRID_CELLS
  const cellH = rect.height / GRID_CELLS
  return {
    left: cx * cellW,
    top: cz * cellH,
    w: cellW,
    h: cellH,
  }
}

/**
 * Convert mouse/client pixel position to grid cell coordinates.
 * Returns null if outside the grid.
 */
function mouseToCell(clientX: number, clientY: number): { x: number; z: number } | null {
  const rect = bjsCanvas.getBoundingClientRect()
  const px = clientX - rect.left
  const py = clientY - rect.top
  if (px < 0 || py < 0 || px >= rect.width || py >= rect.height) {
    return null
  }
  const cx = Math.floor((px / rect.width) * GRID_CELLS)
  const cz = Math.floor((py / rect.height) * GRID_CELLS)
  return { x: cx, z: cz }
}

// ---------------------------------------------------------------------------
// Brush highlight: get list of cells covered by NxN brush at center
// ---------------------------------------------------------------------------

/**
 * Get the set of cells highlighted by an NxN brush centered at (cx, cz).
 * Brush stays within grid bounds (clamped).
 */
function getBrushCells(center: { x: number; z: number }, size: number): Array<{ x: number; z: number }> {
  const half = Math.floor(size / 2)
  const cells: Array<{ x: number; z: number }> = []
  for (let dz = -half; dz <= half; dz++) {
    for (let dx = -half; dx <= half; dx++) {
      const gx = center.x + dx
      const gz = center.z + dz
      if (gx >= 0 && gx < GRID_CELLS && gz >= 0 && gz < GRID_CELLS) {
        cells.push({ x: gx, z: gz })
      }
    }
  }
  return cells
}

// ---------------------------------------------------------------------------
// Bresenham supercover path (matches PathPlan.pointsWithRallyIndex)
// ---------------------------------------------------------------------------

/**
 * Vector subtraction for grid cells.
 */
function cellDelta(a: { x: number; z: number }, b: { x: number; z: number }): { dx: number; dz: number } {
  return { dx: b.x - a.x, dz: b.z - a.z }
}

/**
 * Compute all grid cells on the path from `start` to `end` using Bresenham
 * supercover (8-directional grid path).
 *
 * This algorithm matches TilingPathTool.PathPlan.pointsWithRallyIndex()
 * for the axis-aligned and diagonal segment cases.
 *
 * Returns an array of cells starting at `start` and ending at `end`,
 * including both endpoints. Every adjacent pair is 8-directionally connected.
 */
function bresenhamSupercover(
  start: { x: number; z: number },
  end: { x: number; z: number },
): Array<{ x: number; z: number }> {
  const result: Array<{ x: number; z: number }> = [{ ...start }]

  if (start.x === end.x && start.z === end.z) {
    return result
  }

  const { dx, dz } = cellDelta(start, end)
  const xStep = Math.sign(dx)
  const zStep = Math.sign(dz)

  const axisAligned = xStep === 0 || zStep === 0

  let current = { ...start }
  let inertiaX: number
  let inertiaZ: number

  if (axisAligned) {
    // Walk step by step in the axis-aligned direction
    while (current.x !== end.x || current.z !== end.z) {
      current = { x: current.x + xStep, z: current.z + zStep }
      result.push({ ...current })
    }
  } else {
    // Diagonal: Bresenham supercover
    // Matches the crossed initialization in PathPlan.pointsWithRallyIndex:
    //   xUnderModulo = |offset.Z|, yUnderModulo = |offset.X|
    let xUnderModulo = Math.abs(dz)
    let zUnderModulo = Math.abs(dx)

    const xModulo = xUnderModulo * 2
    const zModulo = zUnderModulo * 2

    // Initial step direction (matches PathPlan logic)
    if (xUnderModulo < zUnderModulo) {
      inertiaX = xStep
      inertiaZ = 0
    } else if (zUnderModulo > xUnderModulo) {
      inertiaX = 0
      inertiaZ = zStep
    } else {
      // Equal: use non-diagonal direction
      if (Math.abs(dx) >= Math.abs(dz)) {
        inertiaX = xStep
        inertiaZ = 0
      } else {
        inertiaX = 0
        inertiaZ = zStep
      }
    }

    while (current.x !== end.x || current.z !== end.z) {
      if (xUnderModulo < zUnderModulo) {
        zUnderModulo -= xUnderModulo
        xUnderModulo = xModulo
        inertiaX = xStep
        inertiaZ = 0
      } else if (xUnderModulo > zUnderModulo) {
        xUnderModulo -= zUnderModulo
        zUnderModulo = zModulo
        inertiaX = 0
        inertiaZ = zStep
      } else if (inertiaX !== 0) {
        xUnderModulo = xModulo
        zUnderModulo = 0
        inertiaX = 0
        inertiaZ = zStep
      } else {
        zUnderModulo = zModulo
        xUnderModulo = 0
        inertiaX = xStep
        inertiaZ = 0
      }

      current = { x: current.x + inertiaX, z: current.z + inertiaZ }
      result.push({ ...current })
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Highlight rendering
// ---------------------------------------------------------------------------

function rgbaStr(c: { r: number; g: number; b: number; a: number }): string {
  return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${c.a.toFixed(2)})`
}

/**
 * Draw the brush highlight, path, and markers on the overlay canvas.
 */
function drawOverlay(): void {
  if (!overlayCtx || !overlayCanvas) return
  const ctx = overlayCtx
  const w = overlayCanvas.width
  const h = overlayCanvas.height

  ctx.clearRect(0, 0, w, h)

  // --- Brush highlight ---
  if (!pathMode && cursorCell) {
    const brushAlpha = highlightOpacity / 100
    const color = { ...BRUSH_COLOR, a: brushAlpha }
    const cells = getBrushCells(cursorCell, brushSize)

    for (const cell of cells) {
      const rect = cellRect(cell.x, cell.z)
      if (!rect) continue
      ctx.save()
      ctx.fillStyle = rgbaStr(color)
      ctx.fillRect(rect.left + 0.5, rect.top + 0.5, rect.w - 1, rect.h - 1)
      // Cell border for brush highlight
      ctx.strokeStyle = 'rgba(100,160,255,0.3)'
      ctx.lineWidth = 0.5
      ctx.strokeRect(rect.left + 0.5, rect.top + 0.5, rect.w - 1, rect.h - 1)
      ctx.restore()
    }

    // Center cursor crosshair
    const center = cellToCanvas(cursorCell.x, cursorCell.z)
    if (center) {
      ctx.save()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.5
      const crossSize = Math.max(3, (overlayCanvas.width / GRID_CELLS) * 0.25)
      ctx.beginPath()
      ctx.moveTo(center.px - crossSize, center.py)
      ctx.lineTo(center.px + crossSize, center.py)
      ctx.moveTo(center.px, center.py - crossSize)
      ctx.lineTo(center.px, center.py + crossSize)
      ctx.stroke()
      ctx.restore()
    }
  }

  // --- Path highlight ---
  if (pathMode && pathStart && pathEnd) {
    const pathCells = bresenhamSupercover(pathStart, pathEnd)

    for (const cell of pathCells) {
      const rect = cellRect(cell.x, cell.z)
      if (!rect) continue
      ctx.save()
      ctx.fillStyle = rgbaStr(PATH_COLOR)
      ctx.fillRect(rect.left + 0.5, rect.top + 0.5, rect.w - 1, rect.h - 1)
      ctx.restore()
    }

    // Draw path line (center-to-center)
    const startCanvas = cellToCanvas(pathStart.x, pathStart.z)
    const endCanvas = cellToCanvas(pathEnd.x, pathEnd.z)
    if (startCanvas && endCanvas) {
      ctx.save()
      ctx.strokeStyle = rgbaStr(PATH_COLOR)
      ctx.lineWidth = 2
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(startCanvas.px, startCanvas.py)
      ctx.lineTo(endCanvas.px, endCanvas.py)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
    }
  }

  // --- Start marker ---
  if (pathStart) {
    const sc = cellToCanvas(pathStart.x, pathStart.z)
    if (sc) {
      ctx.save()
      ctx.fillStyle = rgbaStr(START_COLOR)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.5
      const r = Math.max(4, (overlayCanvas.width / GRID_CELLS) * 0.3)
      ctx.beginPath()
      ctx.arc(sc.px, sc.py, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#ffffff'
      ctx.font = `${Math.max(8, r * 0.7)}px monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('S', sc.px, sc.py)
      ctx.restore()
    }
  }

  // --- End marker ---
  if (pathEnd) {
    const ec = cellToCanvas(pathEnd.x, pathEnd.z)
    if (ec) {
      ctx.save()
      ctx.fillStyle = rgbaStr(END_COLOR)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.5
      const r = Math.max(4, (overlayCanvas.width / GRID_CELLS) * 0.3)
      ctx.beginPath()
      ctx.arc(ec.px, ec.py, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#ffffff'
      ctx.font = `${Math.max(8, r * 0.7)}px monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('E', ec.px, ec.py)
      ctx.restore()
    }
  }

  // --- Path mode preview (show brush at mouse for start/end placement) ---
  if (pathMode && cursorCell) {
    // Show single-cell highlight to indicate click target
    const rect = cellRect(cursorCell.x, cursorCell.z)
    if (rect) {
      ctx.save()
      ctx.strokeStyle = pathStart ? rgbaStr(END_COLOR) : rgbaStr(START_COLOR)
      ctx.lineWidth = 2
      ctx.setLineDash([3, 3])
      ctx.strokeRect(rect.left + 1, rect.top + 1, rect.w - 2, rect.h - 2)
      ctx.setLineDash([])
      ctx.restore()
    }
  }
}

// ---------------------------------------------------------------------------
// Path computation (for test harness)
// ---------------------------------------------------------------------------

function getPathCells(): Array<{ x: number; z: number }> {
  if (!pathStart || !pathEnd) return []
  return bresenhamSupercover(pathStart, pathEnd)
}

function getHighlightedCells(): Array<{ x: number; z: number }> {
  if (!cursorCell) return []
  if (pathMode) {
    return getPathCells()
  }
  return getBrushCells(cursorCell, brushSize)
}

// ---------------------------------------------------------------------------
// Mouse interaction
// ---------------------------------------------------------------------------

function onPointerMove(e: PointerEvent): void {
  const cell = mouseToCell(e.clientX, e.clientY)
  cursorCell = cell
  updateStatusPanel()
  drawOverlay()
}

function onPointerLeave(): void {
  cursorCell = null
  updateStatusPanel()
  drawOverlay()
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return

  const cell = mouseToCell(e.clientX, e.clientY)
  if (!cell) return

  if (pathMode) {
    if (!pathStart) {
      // Set path start
      pathStart = cell
      pathEnd = null
    } else if (!pathEnd) {
      // Set path end
      pathEnd = cell
      // Compute and log path
      const pathCells = bresenhamSupercover(pathStart, pathEnd)
      console.log(
        `[cursor-brush] Path: (${pathStart.x},${pathStart.z}) → (${pathEnd.x},${pathEnd.z}) = ${pathCells.length} cells`,
        pathCells,
      )
    } else {
      // Reset and start new path
      pathStart = cell
      pathEnd = null
    }
  } else {
    // Brush mode: place tile
    const cells = getBrushCells(cell, brushSize)
    const tileColor = TILE_COLORS[selectedTileType] || '#666666'
    // Draw placed tiles on the grid texture (persistent)
    drawTileOnGrid(cells, tileColor)
    console.log(
      `[cursor-brush] Placed ${cells.length} cells of tile "${selectedTileType}" at (${cell.x},${cell.z})`,
    )
  }

  updateStatusPanel()
  drawOverlay()
}

// ---------------------------------------------------------------------------
// Tile placement on grid texture
// ---------------------------------------------------------------------------

/** Store placed tiles for persistent rendering. */
const placedTiles: Map<string, string> = new Map() // key: "x,z" → color

function tileKey(cx: number, cz: number): string {
  return `${cx},${cz}`
}

function drawTileOnGrid(cells: Array<{ x: number; z: number }>, color: string): void {
  const groundMesh = scene.getMeshByName('ground')
  if (!groundMesh) return

  const mat = groundMesh.material as StandardMaterial
  if (!mat || !mat.diffuseTexture) return

  const gridTex = mat.diffuseTexture as DynamicTexture
  const ctx = gridTex.getContext() as CanvasRenderingContext2D
  const cellPx = gridTex.getSize().width / GRID_CELLS

  for (const cell of cells) {
    placedTiles.set(tileKey(cell.x, cell.z), color)
    // Fill the cell with the tile color (semi-transparent overlay)
    ctx.fillStyle = color + '80' // 50% alpha
    ctx.fillRect(cell.x * cellPx + 1, cell.z * cellPx + 1, cellPx - 2, cellPx - 2)
  }

  gridTex.update(false)
}

/**
 * Redraw all placed tiles on the grid texture after a reset.
 */
function redrawPlacedTiles(): void {
  const groundMesh = scene.getMeshByName('ground')
  if (!groundMesh) return

  const mat = groundMesh.material as StandardMaterial
  if (!mat || !mat.diffuseTexture) return

  const gridTex = mat.diffuseTexture as DynamicTexture
  // Redraw the base grid
  drawGridTexture(gridTex, gridTex.getSize().width)

  const ctx = gridTex.getContext() as CanvasRenderingContext2D
  const cellPx = gridTex.getSize().width / GRID_CELLS

  for (const [key, color] of placedTiles) {
    const [cx, cz] = key.split(',').map(Number)
    ctx.fillStyle = color + '80'
    ctx.fillRect(cx * cellPx + 1, cz * cellPx + 1, cellPx - 2, cellPx - 2)
  }

  gridTex.update(false)
}

// ---------------------------------------------------------------------------
// UI Controls
// ---------------------------------------------------------------------------

function setupControls(): void {
  // --- Brush size buttons ---
  const brushBtns = document.querySelectorAll('#controls .brush-size-btn')
  brushBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const size = parseInt((btn as HTMLElement).dataset.size || '5', 10)
      setBrushSize(size)
      // Update active state
      brushBtns.forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
    })
  })

  // --- Tile type selector ---
  const selTile = document.getElementById('sel-tile-type') as HTMLSelectElement
  selTile.addEventListener('change', () => {
    selectTileType(selTile.value)
    // Sync tile panel swatches
    const swatches = document.querySelectorAll('#tile-panel .tile-swatch')
    swatches.forEach((sw) => {
      const row = sw.closest('.tile-row') as HTMLElement | null
      if (row && row.dataset.tile === selTile.value) {
        sw.classList.add('selected')
      } else {
        sw.classList.remove('selected')
      }
    })
  })

  // --- Tile panel rows (click to select) ---
  const tileRows = document.querySelectorAll('#tile-panel .tile-row')
  tileRows.forEach((row) => {
    row.addEventListener('click', () => {
      const tileId = (row as HTMLElement).dataset.tile!
      selectTileType(tileId)
      selTile.value = tileId
      const swatches = document.querySelectorAll('#tile-panel .tile-swatch')
      swatches.forEach((sw) => {
        if (sw.parentElement === row) {
          sw.classList.add('selected')
        } else {
          sw.classList.remove('selected')
        }
      })
    })
  })

  // --- Brush mode button ---
  const btnBrush = document.getElementById('btn-brush-mode')!
  btnBrush.addEventListener('click', () => {
    pathMode = false
    btnBrush.classList.add('active')
    document.getElementById('btn-path-mode')!.classList.remove('active')
    updateStatusPanel()
    drawOverlay()
  })

  // --- Path mode button ---
  const btnPath = document.getElementById('btn-path-mode')!
  btnPath.addEventListener('click', () => {
    pathMode = true
    btnPath.classList.add('active')
    btnBrush.classList.remove('active')
    updateStatusPanel()
    drawOverlay()
  })

  // --- Reset button ---
  const btnReset = document.getElementById('btn-reset')!
  btnReset.addEventListener('click', () => {
    reset()
  })

  // --- Opacity slider ---
  const rangeOpacity = document.getElementById('range-opacity') as HTMLInputElement
  const valOpacity = document.getElementById('val-opacity')!
  rangeOpacity.addEventListener('input', () => {
    highlightOpacity = parseInt(rangeOpacity.value, 10)
    valOpacity.textContent = `${highlightOpacity}%`
    const brushPreviewSwatch = document.getElementById('swatch-brush')!
    brushPreviewSwatch.style.background = `rgba(${BRUSH_COLOR.r},${BRUSH_COLOR.g},${BRUSH_COLOR.b},${(highlightOpacity / 100).toFixed(2)})`
    document.getElementById('tx-brush-color')!.textContent =
      `rgba(${BRUSH_COLOR.r},${BRUSH_COLOR.g},${BRUSH_COLOR.b},${(highlightOpacity / 100).toFixed(2)})`
    drawOverlay()
  })
}

// ---------------------------------------------------------------------------
// Test Harness API (exposed via __testHarness on window)
// ---------------------------------------------------------------------------

function setBrushSize(n: number): void {
  brushSize = Math.max(1, Math.min(21, n))
  // Update UI buttons
  const brushBtns = document.querySelectorAll('#controls .brush-size-btn')
  brushBtns.forEach((btn) => {
    const size = parseInt((btn as HTMLElement).dataset.size || '0', 10)
    if (size === brushSize) {
      btn.classList.add('active')
    } else {
      btn.classList.remove('active')
    }
  })
  console.log(`[cursor-brush] Brush size set to ${brushSize}x${brushSize}`)
  updateStatusPanel()
  drawOverlay()
}

function selectTileType(id: string): void {
  const tile = TILE_TYPES.find((t) => t.id === id)
  if (!tile) {
    console.warn(`[cursor-brush] Unknown tile type: ${id}`)
    return
  }
  const prev = selectedTileType
  selectedTileType = id
  console.log(`[cursor-brush] Tile type changed: ${prev} → ${id}`)
  updateStatusPanel()
}

function setPathStart(cell: { x: number; z: number }): void {
  pathStart = { ...cell }
  console.log(`[cursor-brush] Path start set to (${cell.x},${cell.z})`)
  updateStatusPanel()
  drawOverlay()
}

function setPathEnd(cell: { x: number; z: number }): void {
  pathEnd = { ...cell }
  const pathCells = getPathCells()
  console.log(
    `[cursor-brush] Path end set to (${cell.x},${cell.z}). Path: ${pathCells.length} cells`,
    pathCells,
  )
  updateStatusPanel()
  drawOverlay()
}

function reset(): void {
  brushSize = 5
  selectedTileType = 'Sand'
  cursorCell = null
  pathMode = false
  pathStart = null
  pathEnd = null
  highlightOpacity = 40
  placedTiles.clear()

  // Reset UI
  document.getElementById('btn-brush-mode')!.classList.add('active')
  document.getElementById('btn-path-mode')!.classList.remove('active')
  const selTile = document.getElementById('sel-tile-type') as HTMLSelectElement
  selTile.value = 'Sand'
  const swatches = document.querySelectorAll('#tile-panel .tile-swatch')
  swatches.forEach((sw) => {
    const row = sw.closest('.tile-row') as HTMLElement | null
    if (row && row.dataset.tile === 'Sand') {
      sw.classList.add('selected')
    } else {
      sw.classList.remove('selected')
    }
  })
  const brushBtns = document.querySelectorAll('#controls .brush-size-btn')
  brushBtns.forEach((btn) => {
    const size = parseInt((btn as HTMLElement).dataset.size || '0', 10)
    if (size === 5) btn.classList.add('active')
    else btn.classList.remove('active')
  })
  const rangeOpacity = document.getElementById('range-opacity') as HTMLInputElement
  rangeOpacity.value = '40'
  document.getElementById('val-opacity')!.textContent = '40%'

  // Redraw grid without placed tiles
  redrawPlacedTiles()

  updateStatusPanel()
  drawOverlay()
  console.log('[cursor-brush] Reset complete')
}

// ---------------------------------------------------------------------------
// Status Panel Update
// ---------------------------------------------------------------------------

function updateStatusPanel(): void {
  document.getElementById('st-cursor')!.textContent = cursorCell
    ? `(${cursorCell.x}, ${cursorCell.z})`
    : '-'
  document.getElementById('st-brush-size')!.textContent = `${brushSize}x${brushSize}`
  const highlighted = getHighlightedCells()
  document.getElementById('st-highlight-count')!.textContent = String(highlighted.length)
  document.getElementById('st-tile')!.textContent = selectedTileType

  // Brush preview panel
  document.getElementById('st-path-start')!.textContent = pathStart
    ? `(${pathStart.x},${pathStart.z})`
    : '-'
  document.getElementById('st-path-end')!.textContent = pathEnd
    ? `(${pathEnd.x},${pathEnd.z})`
    : '-'
  document.getElementById('st-path-count')!.textContent = (pathStart && pathEnd)
    ? String(getPathCells().length)
    : '0'
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
// Pointer events
// ---------------------------------------------------------------------------

function setupInteraction(): void {
  bjsCanvas.addEventListener('pointermove', onPointerMove)
  bjsCanvas.addEventListener('pointerleave', onPointerLeave)
  bjsCanvas.addEventListener('pointerdown', onPointerDown)
  bjsCanvas.addEventListener('contextmenu', (e) => e.preventDefault())
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

setupScene()
setupOverlay()
setupControls()
setupInteraction()
updateStatusPanel()
updateInfoBar()

// Set initial brush size active button
const initialBrushBtns = document.querySelectorAll('#controls .brush-size-btn')
initialBrushBtns.forEach((btn) => {
  const size = parseInt((btn as HTMLElement).dataset.size || '0', 10)
  if (size === 5) btn.classList.add('active')
  else btn.classList.remove('active')
})

engine.runRenderLoop(() => {
  scene.render()
  updateInfoBar()
})

window.addEventListener('resize', () => {
  engine.resize()
  resizeOverlay()
  drawOverlay()
})

// ---------------------------------------------------------------------------
// Expose test harness
// ---------------------------------------------------------------------------

const testHarness = {
  setBrushSize,
  selectTileType,
  setPathStart,
  setPathEnd,
  getHighlightedCells,
  getPathCells,
  reset,
  getBrushSize: () => brushSize,
  getSelectedTileType: () => selectedTileType,
  getCursorCell: () => cursorCell,
  getPathStart: () => pathStart,
  getPathEnd: () => pathEnd,
  isPathMode: () => pathMode,
  getGridCells: () => GRID_CELLS,
  getPlacedTiles: () => new Map(placedTiles),
  getHighlightOpacity: () => highlightOpacity,
  setHighlightOpacity: (pct: number) => {
    highlightOpacity = Math.max(10, Math.min(90, pct))
    document.getElementById('val-opacity')!.textContent = `${highlightOpacity}%`
    ;(document.getElementById('range-opacity') as HTMLInputElement).value = String(highlightOpacity)
    drawOverlay()
  },
}

;(window as unknown as Record<string, unknown>).__testHarness = testHarness

console.log(
  '%c[cursor-brush] Test harness ready. Use window.__testHarness for API.',
  'color: #4a9; font-weight: bold',
)
console.log('  __testHarness.setBrushSize(n)    - Set brush to NxN (1,3,5,...)')
console.log('  __testHarness.selectTileType(id) - Select tile type (Sand, Rock, Grass, Water, Road, Cliff)')
console.log('  __testHarness.setPathStart(cell) - Set path start {x, z}')
console.log('  __testHarness.setPathEnd(cell)   - Set path end {x, z}')
console.log('  __testHarness.getHighlightedCells() - Get currently highlighted cells')
console.log('  __testHarness.getPathCells()     - Get path cells (Bresenham)')
console.log('  __testHarness.reset()           - Reset all state')
