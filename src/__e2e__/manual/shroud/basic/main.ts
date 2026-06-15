/**
 * shroud/basic/main.ts — ShroudRenderer visual acceptance test
 *
 * Verifies:
 * 1. Three-state visibility: Hidden (black), Explored (dim), Visible (transparent)
 * 2. Edge blending: gradient strips at state boundaries (Canvas2D)
 * 3. Dynamic updates: brush interaction redraws overlay texture < 50ms
 * 4. Terrain visibility: green checkerboard visible through transparent cells
 *
 * Architecture mirrors ShroudRenderer:
 *   - Uint8Array visibilityData[cellIndex] (0=Hidden, 1=Explored, 2=Visible)
 *   - Per-cell dirty tracking via dirty flag set
 *   - Canvas2D DynamicTexture as shroud overlay (analogous to RTT + ShaderMaterial)
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

/** Number of cells in X direction (columns). */
const GRID_WIDTH = 16
/** Number of cells in Y direction (rows). */
const GRID_HEIGHT = 16
/** World-space size of each cell. */
const CELL_SIZE = 0.5
/** Total number of cells. */
const TOTAL_CELLS = GRID_WIDTH * GRID_HEIGHT
/** World-space width of the entire grid. */
const GRID_WORLD_W = GRID_WIDTH * CELL_SIZE // 8
/** World-space height of the entire grid. */
const GRID_WORLD_H = GRID_HEIGHT * CELL_SIZE // 8

/** Canvas texture resolution (square). Cells are TEX_RES/GRID_WIDTH pixels each. */
const TEX_RES = 512
/** Pixels per cell in the texture. */
const CELL_PX = TEX_RES / GRID_WIDTH // 32

/** Width of edge-blending gradient strips in pixels. */
const EDGE_GRADIENT_PX = 4
/** Half of edge gradient width for positioning. */
const EDGE_HALF = EDGE_GRADIENT_PX / 2

// ---------------------------------------------------------------------------
// Visibility State Constants (matching ShroudRenderer._visibilityData)
// ---------------------------------------------------------------------------

const HIDDEN = 0
const EXPLORED = 1
const VISIBLE = 2

// ---------------------------------------------------------------------------
// Visibility Data Array (mirrors ShroudRenderer._visibilityData: Uint8Array)
// ---------------------------------------------------------------------------

const visibilityData = new Uint8Array(TOTAL_CELLS)
visibilityData.fill(HIDDEN)

// ---------------------------------------------------------------------------
// Dirty Set (mirrors ShroudRenderer._cellsDirty + _anyCellDirty)
// ---------------------------------------------------------------------------

const dirtyCells = new Set<number>()
let anyCellDirty = false

function markDirty(index: number): void {
  dirtyCells.add(index)
  anyCellDirty = true
}

// ---------------------------------------------------------------------------
// Index Helpers (mirrors ShroudRenderer._cellIndex)
// ---------------------------------------------------------------------------

function cellIndex(col: number, row: number): number {
  return row * GRID_WIDTH + col
}

function isValidCell(col: number, row: number): boolean {
  return col >= 0 && col < GRID_WIDTH && row >= 0 && row < GRID_HEIGHT
}

// ---------------------------------------------------------------------------
// State → Color Mapping
// ---------------------------------------------------------------------------

interface CellRGBA {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

function stateToRGBA(state: number): CellRGBA {
  switch (state) {
    case HIDDEN:
      return { r: 0, g: 0, b: 0, a: 1.0 }
    case EXPLORED:
      return { r: 15, g: 15, b: 15, a: 0.55 }
    case VISIBLE:
      return { r: 0, g: 0, b: 0, a: 0.0 }
    default:
      return { r: 0, g: 0, b: 0, a: 1.0 }
  }
}

function rgbaToCSS(c: CellRGBA): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`
}

// ---------------------------------------------------------------------------
// State Names
// ---------------------------------------------------------------------------

function stateName(state: number): string {
  switch (state) {
    case HIDDEN:
      return 'Hidden'
    case EXPLORED:
      return 'Explored'
    case VISIBLE:
      return 'Visible'
    default:
      return 'Unknown'
  }
}

// ---------------------------------------------------------------------------
// Canvas2D Shroud Texture Rendering
// ---------------------------------------------------------------------------

let dynamicTexture: DynamicTexture | null = null

/**
 * Draw the entire shroud overlay onto the Canvas2D context.
 *
 * Phase 1: Draw all cells with base color.
 * Phase 2: Draw edge-blending gradient strips at state boundaries.
 *
 * Performance: 256 cells + ~480 edge checks. Must complete < 50ms.
 */
function drawShroudOverlay(ctx: CanvasRenderingContext2D): void {
  const w = TEX_RES
  const h = TEX_RES

  // Clear canvas
  ctx.clearRect(0, 0, w, h)

  // --- Phase 1: Base cell rendering ---
  for (let row = 0; row < GRID_HEIGHT; row++) {
    for (let col = 0; col < GRID_WIDTH; col++) {
      const idx = cellIndex(col, row)
      const state = visibilityData[idx]
      if (state === VISIBLE) continue // transparent — nothing to draw

      const px = col * CELL_PX
      const py = row * CELL_PX
      const c = stateToRGBA(state)

      ctx.fillStyle = rgbaToCSS(c)
      ctx.fillRect(px, py, CELL_PX, CELL_PX)
    }
  }

  // --- Phase 2: Edge blending gradients ---
  // Iterate all adjacent cell pairs. For each pair with different states,
  // draw a gradient strip along the shared border.

  for (let row = 0; row < GRID_HEIGHT; row++) {
    for (let col = 0; col < GRID_WIDTH; col++) {
      const idx = cellIndex(col, row)
      const state = visibilityData[idx]

      // --- Horizontal edge (right neighbor) ---
      if (col + 1 < GRID_WIDTH) {
        const rightIdx = cellIndex(col + 1, row)
        const rightState = visibilityData[rightIdx]
        if (state !== rightState) {
          const gx = (col + 1) * CELL_PX - EDGE_HALF
          const gy = row * CELL_PX
          const leftRGBA = stateToRGBA(state)
          const rightRGBA = stateToRGBA(rightState)

          const grad = ctx.createLinearGradient(gx, 0, gx + EDGE_GRADIENT_PX, 0)
          grad.addColorStop(0, rgbaToCSS(leftRGBA))
          grad.addColorStop(1, rgbaToCSS(rightRGBA))
          ctx.fillStyle = grad
          ctx.fillRect(gx, gy, EDGE_GRADIENT_PX, CELL_PX)
        }
      }

      // --- Vertical edge (bottom neighbor) ---
      if (row + 1 < GRID_HEIGHT) {
        const bottomIdx = cellIndex(col, row + 1)
        const bottomState = visibilityData[bottomIdx]
        if (state !== bottomState) {
          const gx = col * CELL_PX
          const gy = (row + 1) * CELL_PX - EDGE_HALF
          const topRGBA = stateToRGBA(state)
          const bottomRGBA = stateToRGBA(bottomState)

          const grad = ctx.createLinearGradient(0, gy, 0, gy + EDGE_GRADIENT_PX)
          grad.addColorStop(0, rgbaToCSS(topRGBA))
          grad.addColorStop(1, rgbaToCSS(bottomRGBA))
          ctx.fillStyle = grad
          ctx.fillRect(gx, gy, CELL_PX, EDGE_GRADIENT_PX)
        }
      }
    }
  }
}

/**
 * Update the DynamicTexture from the visibility data.
 * Only called when anyCellDirty is true.
 *
 * Mirrors ShroudRenderer._updateShroudTexture(region).
 */
function updateShroudTexture(): void {
  if (!anyCellDirty) return
  if (!dynamicTexture) return

  const ctx = dynamicTexture.getContext() as CanvasRenderingContext2D
  drawShroudOverlay(ctx)
  dynamicTexture.update(false) // false = don't invert Y

  dirtyCells.clear()
  anyCellDirty = false
}

// ---------------------------------------------------------------------------
// Preset Patterns
// ---------------------------------------------------------------------------

function setAllCells(value: number): void {
  for (let i = 0; i < TOTAL_CELLS; i++) {
    if (visibilityData[i] !== value) {
      visibilityData[i] = value
      markDirty(i)
    }
  }
}

function presetAllVisible(): void {
  setAllCells(VISIBLE)
  updateShroudTexture()
}

function presetAllExplored(): void {
  setAllCells(EXPLORED)
  updateShroudTexture()
}

function presetAllHidden(): void {
  setAllCells(HIDDEN)
  updateShroudTexture()
}

function presetCircular(): void {
  const cx = Math.floor(GRID_WIDTH / 2) // 8
  const cy = Math.floor(GRID_HEIGHT / 2) // 8
  const visibleRadius = 5
  const exploredRadius = 8

  for (let row = 0; row < GRID_HEIGHT; row++) {
    for (let col = 0; col < GRID_WIDTH; col++) {
      const idx = cellIndex(col, row)
      const dx = col - cx
      const dy = row - cy
      const dist = Math.sqrt(dx * dx + dy * dy)

      let newState: number
      if (dist <= visibleRadius) {
        newState = VISIBLE
      } else if (dist <= exploredRadius) {
        newState = EXPLORED
      } else {
        newState = HIDDEN
      }

      if (visibilityData[idx] !== newState) {
        visibilityData[idx] = newState
        markDirty(idx)
      }
    }
  }

  updateShroudTexture()
}

// ---------------------------------------------------------------------------
// Brush Painting
// ---------------------------------------------------------------------------

let brushMode: number = VISIBLE
let brushRadius: number = 2

function applyBrush(centerCol: number, centerRow: number): void {
  const r = brushRadius
  for (let row = centerRow - r; row <= centerRow + r; row++) {
    for (let col = centerCol - r; col <= centerCol + r; col++) {
      if (!isValidCell(col, row)) continue
      const dx = col - centerCol
      const dy = row - centerRow
      if (dx * dx + dy * dy > r * r) continue

      const idx = cellIndex(col, row)
      if (visibilityData[idx] !== brushMode) {
        visibilityData[idx] = brushMode
        markDirty(idx)
      }
    }
  }

  updateShroudTexture()
}

// ---------------------------------------------------------------------------
// Cell Inspector (hover tracking)
// ---------------------------------------------------------------------------

function updateCellInspector(col: number, row: number): void {
  const coordEl = document.getElementById('insp-coord')!
  const stateEl = document.getElementById('insp-state')!
  const visibleEl = document.getElementById('insp-visible')!
  const exploredEl = document.getElementById('insp-explored')!

  if (!isValidCell(col, row)) {
    coordEl.textContent = '-'
    stateEl.textContent = '-'
    visibleEl.textContent = '-'
    exploredEl.textContent = '-'
    return
  }

  const idx = cellIndex(col, row)
  const state = visibilityData[idx]

  coordEl.textContent = `(${col}, ${row})`
  stateEl.textContent = `${state} (${stateName(state)})`
  visibleEl.textContent = state === VISIBLE ? '是' : '否'
  exploredEl.textContent = state === EXPLORED || state === VISIBLE ? '是' : '否'
}

// ---------------------------------------------------------------------------
// Info Bar Update
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
  let hidden = 0
  let explored = 0
  let visible = 0
  for (let i = 0; i < TOTAL_CELLS; i++) {
    switch (visibilityData[i]) {
      case HIDDEN:
        hidden++
        break
      case EXPLORED:
        explored++
        break
      case VISIBLE:
        visible++
        break
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

function setupScene(): {
  engine: Engine
  scene: Scene
  pickPlane: AbstractMesh
} {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: false,
  })
  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.12, 0.14, 0.18, 1)

  // Camera — positioned for top-down view of the 8x8 grid
  const camera = new ArcRotateCamera(
    'camera',
    -Math.PI / 4,
    Math.PI / 3.5,
    10,
    new Vector3(GRID_WORLD_W / 2, 0, GRID_WORLD_H / 2),
    scene,
  )
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 2
  camera.upperRadiusLimit = 30
  // Pan sensitivity
  camera.panningSensibility = 50

  // Lights
  new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)

  // -------------------------------------------------------------------------
  // Terrain Base Plane — green checkerboard (visible through shroud)
  // -------------------------------------------------------------------------

  // Create checkerboard via Canvas2D
  const terrainTexRes = 512
  const terrainTex = new DynamicTexture(
    'terrainTex',
    { width: terrainTexRes, height: terrainTexRes / 2 },
    scene,
    false,
  )
  const tctx = terrainTex.getContext() as CanvasRenderingContext2D
  const checkerCols = 8
  const checkerRows = 4
  const checkerW = terrainTexRes / checkerCols
  const checkerH = (terrainTexRes / 2) / checkerRows
  for (let row = 0; row < checkerRows; row++) {
    for (let col = 0; col < checkerCols; col++) {
      const isDark = (row + col) % 2 === 0
      tctx.fillStyle = isDark ? '#1a5c1a' : '#2a7c2a'
      tctx.fillRect(col * checkerW, row * checkerH, checkerW, checkerH)
    }
  }
  // Draw grid lines
  tctx.strokeStyle = '#0d3d0d'
  tctx.lineWidth = 1
  for (let i = 0; i <= checkerCols; i++) {
    tctx.beginPath()
    tctx.moveTo(i * checkerW, 0)
    tctx.lineTo(i * checkerW, terrainTexRes / 2)
    tctx.stroke()
  }
  for (let i = 0; i <= checkerRows; i++) {
    tctx.beginPath()
    tctx.moveTo(0, i * checkerH)
    tctx.lineTo(terrainTexRes, i * checkerH)
    tctx.stroke()
  }
  terrainTex.update(false)

  const terrainMat = new StandardMaterial('terrainMat', scene)
  terrainMat.diffuseTexture = terrainTex
  terrainMat.specularColor = new Color3(0.05, 0.05, 0.05)

  const terrainPlane = MeshBuilder.CreateGround(
    'terrainPlane',
    { width: GRID_WORLD_W, height: GRID_WORLD_H, subdivisions: 1 },
    scene,
  )
  terrainPlane.position = new Vector3(GRID_WORLD_W / 2, -0.005, GRID_WORLD_H / 2)
  terrainPlane.material = terrainMat

  // -------------------------------------------------------------------------
  // Shroud Overlay Plane — DynamicTexture with visibility data
  // -------------------------------------------------------------------------

  dynamicTexture = new DynamicTexture(
    'shroudTex',
    { width: TEX_RES, height: TEX_RES },
    scene,
    false,
  )
  const sctx = dynamicTexture.getContext() as CanvasRenderingContext2D
  drawShroudOverlay(sctx)
  dynamicTexture.update(false)

  const shroudMat = new StandardMaterial('shroudMat', scene)
  shroudMat.diffuseTexture = dynamicTexture
  shroudMat.specularColor = new Color3(0, 0, 0)
  shroudMat.useAlphaFromDiffuseTexture = true
  shroudMat.backFaceCulling = false

  const shroudPlane = MeshBuilder.CreateGround(
    'shroudPlane',
    { width: GRID_WORLD_W, height: GRID_WORLD_H, subdivisions: 1 },
    scene,
  )
  shroudPlane.position = new Vector3(GRID_WORLD_W / 2, 0.0, GRID_WORLD_H / 2)
  shroudPlane.material = shroudMat

  // -------------------------------------------------------------------------
  // Grid frame — wireframe outline around the grid
  // -------------------------------------------------------------------------

  const frameLines: Vector3[][] = []
  const baseX = 0
  const baseZ = 0
  const w = GRID_WORLD_W
  const hVal = GRID_WORLD_H
  const y = 0.001
  frameLines.push([
    new Vector3(baseX, y, baseZ),
    new Vector3(baseX + w, y, baseZ),
    new Vector3(baseX + w, y, baseZ + hVal),
    new Vector3(baseX, y, baseZ + hVal),
    new Vector3(baseX, y, baseZ),
  ])
  const frameMesh = MeshBuilder.CreateLineSystem(
    'frameLines',
    { lines: frameLines, colors: [[new Color4(0.3, 0.5, 0.3, 1)]] },
    scene,
  )

  // Suppress unused variable
  void frameMesh

  return { engine, scene, pickPlane: shroudPlane }
}

// ---------------------------------------------------------------------------
// Mouse Interaction
// ---------------------------------------------------------------------------

function setupInteraction(
  scene: Scene,
  pickPlane: AbstractMesh,
  engine: Engine,
): void {
  let isDragging = false

  /**
   * Convert a Babylon.js pointer position to grid cell coordinates.
   * Uses scene.pick() raycasting against the shroud plane.
   */
  function screenToGrid(px: number, py: number): { col: number; row: number } | null {
    const pick = scene.pick(px, py, (mesh) => mesh === pickPlane)
    if (!pick || !pick.pickedPoint) return null

    const worldX = pick.pickedPoint.x
    const worldZ = pick.pickedPoint.z

    const col = Math.floor(worldX / CELL_SIZE)
    const row = Math.floor(worldZ / CELL_SIZE)

    if (!isValidCell(col, row)) return null
    return { col, row }
  }

  // Pointer down
  scene.onPointerObservable.add((pointerInfo) => {
    const e = pointerInfo.event as PointerEvent
    // Left button only
    if (e.button !== 0) return

    isDragging = true
    const grid = screenToGrid(scene.pointerX, scene.pointerY)
    if (grid) {
      applyBrush(grid.col, grid.row)
    }
  }, PointerEventTypes.POINTERDOWN)

  // Pointer move (dragging and hovering)
  scene.onPointerObservable.add((_pointerInfo) => {
    if (isDragging) {
      const grid = screenToGrid(scene.pointerX, scene.pointerY)
      if (grid) {
        applyBrush(grid.col, grid.row)
      }
    }

    // Cell inspector (hover)
    const grid = screenToGrid(scene.pointerX, scene.pointerY)
    if (grid) {
      updateCellInspector(grid.col, grid.row)
    } else {
      updateCellInspector(-1, -1)
    }
  }, PointerEventTypes.POINTERMOVE)

  // Pointer up
  scene.onPointerObservable.add(() => {
    isDragging = false
  }, PointerEventTypes.POINTERUP)

  // Prevent default context menu on the rendering canvas
  const canvas = engine.getRenderingCanvas()
  canvas?.addEventListener('contextmenu', (e) => {
    e.preventDefault()
  })
}

// ---------------------------------------------------------------------------
// UI Controls
// ---------------------------------------------------------------------------

function setupControls(): void {
  // Brush mode buttons
  const btnReveal = document.getElementById('btn-reveal')!
  const btnExplore = document.getElementById('btn-explore')!
  const btnHide = document.getElementById('btn-hide')!

  function updateBrushButtons(): void {
    btnReveal.classList.toggle('active', brushMode === VISIBLE)
    btnExplore.classList.toggle('active', brushMode === EXPLORED)
    btnHide.classList.toggle('active', brushMode === HIDDEN)
  }

  btnReveal.addEventListener('click', () => {
    brushMode = VISIBLE
    updateBrushButtons()
  })
  btnExplore.addEventListener('click', () => {
    brushMode = EXPLORED
    updateBrushButtons()
  })
  btnHide.addEventListener('click', () => {
    brushMode = HIDDEN
    updateBrushButtons()
  })

  // Brush radius slider
  const rangeBrush = document.getElementById('range-brush') as HTMLInputElement
  const valBrush = document.getElementById('val-brush')!
  rangeBrush.addEventListener('input', () => {
    brushRadius = parseInt(rangeBrush.value, 10)
    valBrush.textContent = String(brushRadius)
  })

  // Preset buttons
  document.getElementById('btn-all-visible')!.addEventListener('click', presetAllVisible)
  document.getElementById('btn-all-explored')!.addEventListener('click', presetAllExplored)
  document.getElementById('btn-all-hidden')!.addEventListener('click', presetAllHidden)
  document.getElementById('btn-circular')!.addEventListener('click', presetCircular)

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    switch (e.key) {
      case '1':
        brushMode = VISIBLE
        updateBrushButtons()
        break
      case '2':
        brushMode = EXPLORED
        updateBrushButtons()
        break
      case '3':
        brushMode = HIDDEN
        updateBrushButtons()
        break
      case 'r':
      case 'R':
        presetAllHidden()
        break
      case 'f':
      case 'F':
        presetAllExplored()
        break
    }
  })
}

// ---------------------------------------------------------------------------
// Main Initialization
// ---------------------------------------------------------------------------

const { engine, scene, pickPlane } = setupScene()
setupControls()
setupInteraction(scene, pickPlane, engine)

// Initialize with all-hidden state
presetAllHidden()

engine.runRenderLoop(() => {
  scene.render()
  updateInfoBar(engine)
})

window.addEventListener('resize', () => {
  engine.resize()
})

// Expose for test harness / dev tools
;(window as unknown as Record<string, unknown>).__shroudTest = {
  visibilityData,
  dirtyCells,
  engine,
  scene,
  getStateCounts: countStates,
  presetAllVisible,
  presetAllExplored,
  presetAllHidden,
  presetCircular,
  applyBrush,
  setBrushMode: (mode: number) => { brushMode = mode },
  setBrushRadius: (r: number) => { brushRadius = r },
}
