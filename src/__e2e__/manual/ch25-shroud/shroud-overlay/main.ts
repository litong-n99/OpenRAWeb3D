/**
 * ch25-shroud/shroud-overlay/main.ts — Shroud Overlay 3D Acceptance Test
 *
 * Verifies the 3D shroud overlay rendering behaviour:
 * 1. Hidden cells: opaque black (alpha=1.0), terrain fully obscured
 * 2. Explored cells: semi-transparent dark blue-gray (alpha≈0.55), terrain partially visible
 * 3. Visible cells: fully transparent (alpha=0.0), terrain fully visible
 * 4. Edge blending: 4px Canvas2D gradient strips at state boundaries
 * 5. 3D positioning: overlay plane stays correctly positioned above terrain through camera rotation
 *
 * This is a self-contained simulation — it does NOT import from the real ShroudRenderer.
 * It uses a Uint8Array visibility buffer + Canvas2D DynamicTexture rendered on a
 * Babylon.js ground-plane Mesh.
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
  DynamicTexture,
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
// Visibility State Constants (matching Shroud.CellVisibility enum)
// ---------------------------------------------------------------------------

const HIDDEN = 0
const EXPLORED = 1
const VISIBLE = 2

// ---------------------------------------------------------------------------
// Visibility Data Array (mirrors ShroudRenderer._visibilityData)
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
// Index Helpers
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
      // Dark blue-gray: rgba(18, 20, 32, 0.55)
      return { r: 18, g: 20, b: 32, a: 0.55 }
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
      return 'Hidden (0)'
    case EXPLORED:
      return 'Explored (1)'
    case VISIBLE:
      return 'Visible (2)'
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
 * Phase 1: Draw all cells with base color (skip VISIBLE cells — they are transparent).
 * Phase 2: Draw edge-blending gradient strips at state boundaries.
 *
 * Performance requirement: < 50ms for 256 cells + edge gradients.
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
// Cell State Modification
// ---------------------------------------------------------------------------

function setCellState(col: number, row: number, state: number): void {
  if (!isValidCell(col, row)) return
  const idx = cellIndex(col, row)
  if (visibilityData[idx] !== state) {
    visibilityData[idx] = state
    markDirty(idx)
  }
}

function applyRadius(col: number, row: number, radius: number, state: number): void {
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      if (!isValidCell(col + dc, row + dr)) continue
      const dist = Math.sqrt(dc * dc + dr * dr)
      if (dist > radius) continue
      setCellState(col + dc, row + dr, state)
    }
  }
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

/**
 * Circular pattern: center Visible, middle Explored ring, outer Hidden.
 * Visible radius = 5 cells, Explored radius = 8 cells (full grid).
 * Produces all three states simultaneously with gradient boundaries.
 */
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
// Status Counting
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Info Bar Update
// ---------------------------------------------------------------------------

function getInfoElements() {
  return {
    ua: document.getElementById('info-ua')!,
    viewport: document.getElementById('info-viewport')!,
    engine: document.getElementById('info-engine')!,
    fps: document.getElementById('info-fps')!,
    time: document.getElementById('info-time')!,
    statHidden: document.getElementById('stat-hidden')!,
    statExplored: document.getElementById('stat-explored')!,
    statVisible: document.getElementById('stat-visible')!,
    statTotal: document.getElementById('stat-total')!,
  }
}

function updateInfoBar(engine: Engine): void {
  const el = getInfoElements()
  el.ua.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  el.viewport.textContent = `${window.innerWidth}x${window.innerHeight}`
  el.engine.textContent = engine.webGLVersion === 2 ? 'WebGL 2.0' : 'WebGL 1.0'
  el.fps.textContent = String(Math.round(engine.getFps()))
  el.time.textContent = new Date().toISOString()

  const counts = countStates()
  el.statHidden.textContent = String(counts.hidden)
  el.statExplored.textContent = String(counts.explored)
  el.statVisible.textContent = String(counts.visible)
  el.statTotal.textContent = String(counts.hidden + counts.explored + counts.visible)
}

// ---------------------------------------------------------------------------
// Cell Inspector (hover tracking)
// ---------------------------------------------------------------------------

function updateCellInspector(col: number, row: number): void {
  const coordEl = document.getElementById('insp-coord')!
  const stateEl = document.getElementById('insp-state')!

  if (!isValidCell(col, row)) {
    coordEl.textContent = '-'
    stateEl.textContent = '-'
    return
  }

  const idx = cellIndex(col, row)
  const state = visibilityData[idx]

  coordEl.textContent = `(${col}, ${row})`
  stateEl.textContent = `${stateName(state)}`
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
  scene.clearColor = new Color4(0.10, 0.12, 0.16, 1)

  // Camera — positioned for elevated perspective view of the 8x8 grid
  const gridCenter = new Vector3(GRID_WORLD_W / 2, 0, GRID_WORLD_H / 2)
  const camera = new ArcRotateCamera(
    'camera',
    -Math.PI / 4, // alpha: azimuth angle
    Math.PI / 3.5, // beta: elevation angle (~51 degrees from horizontal)
    12, // radius: distance from target
    gridCenter,
    scene,
  )
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 3
  camera.upperRadiusLimit = 30
  camera.panningSensibility = 50
  // Prevent the default right-click drag from interfering
  camera.useNaturalPinchZoom = true

  // Lights — ambient + directional for subtle shading on the terrain
  new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)

  // -------------------------------------------------------------------------
  // Terrain Base Plane — solid green, visible through transparent shroud areas
  // -------------------------------------------------------------------------

  // Create a solid green terrain texture with subtle cell grid lines baked in
  const terrainTexRes = 512
  const terrainTex = new DynamicTexture(
    'terrainTex',
    { width: terrainTexRes, height: terrainTexRes },
    scene,
    false,
  )
  const tctx = terrainTex.getContext() as CanvasRenderingContext2D
  // Fill with solid grass green
  tctx.fillStyle = '#2d5a1e'
  tctx.fillRect(0, 0, terrainTexRes, terrainTexRes)

  // Draw subtle cell grid lines (dark green) so cell boundaries are visible
  // even when the shroud is partially or fully transparent
  const lineInterval = terrainTexRes / GRID_WIDTH // 32px
  tctx.strokeStyle = '#1a3d10'
  tctx.lineWidth = 1
  for (let i = 0; i <= GRID_WIDTH; i++) {
    const pos = i * lineInterval
    tctx.beginPath()
    tctx.moveTo(pos, 0)
    tctx.lineTo(pos, terrainTexRes)
    tctx.stroke()
    tctx.beginPath()
    tctx.moveTo(0, pos)
    tctx.lineTo(terrainTexRes, pos)
    tctx.stroke()
  }
  terrainTex.update(false)

  const terrainMat = new StandardMaterial('terrainMat', scene)
  terrainMat.diffuseTexture = terrainTex
  terrainMat.specularColor = new Color3(0.02, 0.02, 0.02)
  terrainMat.backFaceCulling = false

  const terrainPlane = MeshBuilder.CreateGround(
    'terrainPlane',
    { width: GRID_WORLD_W, height: GRID_WORLD_H, subdivisions: 1 },
    scene,
  )
  // Position: center at (4, -0.005, 4) — slightly below Y=0 to avoid Z-fighting
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
  // Ensure the shroud renders on top of terrain (higher renderingGroupId or just Y offset)
  shroudMat.disableLighting = true
  // Transparency settings
  shroudMat.transparencyMode = 2 // MATERIAL_ALPHABLEND
  shroudMat.separateCullingPass = true

  const shroudPlane = MeshBuilder.CreateGround(
    'shroudPlane',
    { width: GRID_WORLD_W, height: GRID_WORLD_H, subdivisions: 1 },
    scene,
  )
  // Position: at Y=0.0, exactly 0.005 units above the terrain to prevent Z-fighting
  shroudPlane.position = new Vector3(GRID_WORLD_W / 2, 0.0, GRID_WORLD_H / 2)
  shroudPlane.material = shroudMat

  // -------------------------------------------------------------------------
  // Grid Frame — wireframe outline around the grid perimeter (world-space)
  // -------------------------------------------------------------------------

  const frameLines: Vector3[][] = []
  const y = 0.003
  frameLines.push([
    new Vector3(0, y, 0),
    new Vector3(GRID_WORLD_W, y, 0),
    new Vector3(GRID_WORLD_W, y, GRID_WORLD_H),
    new Vector3(0, y, GRID_WORLD_H),
    new Vector3(0, y, 0),
  ])
  // Each line's colors array must have one Color4 per vertex.
  // frameLines[0] has 5 vertices → provide 5 copies of the same color.
  const frameColor = new Color4(0.5, 0.7, 0.5, 0.8)
  const frameMesh = MeshBuilder.CreateLineSystem(
    'frameLines',
    { lines: frameLines, colors: [[frameColor, frameColor, frameColor, frameColor, frameColor]] },
    scene,
  )

  // frameMesh is added to the scene by CreateLineSystem — void suppresses TS6133 unused-variable warning
  void frameMesh

  return { engine, scene, pickPlane: shroudPlane }
}

// ---------------------------------------------------------------------------
// Mouse / Pointer Interaction (raycasting against shroud plane)
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

  // Pointer down — apply brush on click
  scene.onPointerObservable.add((pointerInfo) => {
    const e = pointerInfo.event as PointerEvent
    // Left button only
    if (e.button !== 0) return

    isDragging = true
    const grid = screenToGrid(scene.pointerX, scene.pointerY)
    if (grid) {
      applyRadius(grid.col, grid.row, brushRadius, brushMode)
      updateShroudTexture()
    }
  }, PointerEventTypes.POINTERDOWN)

  // Pointer move — continue dragging + hover inspector
  scene.onPointerObservable.add((_pointerInfo) => {
    if (isDragging) {
      const grid = screenToGrid(scene.pointerX, scene.pointerY)
      if (grid) {
        applyRadius(grid.col, grid.row, brushRadius, brushMode)
        updateShroudTexture()
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

let brushMode: number = VISIBLE
let brushRadius: number = 1

function setupControls(): void {
  // Mode buttons
  const btnReveal = document.getElementById('btn-reveal')!
  const btnExplore = document.getElementById('btn-explore')!

  function updateModeButtons(): void {
    btnReveal.classList.toggle('active', brushMode === VISIBLE)
    btnExplore.classList.toggle('active', brushMode === EXPLORED)
  }

  btnReveal.addEventListener('click', () => {
    brushMode = VISIBLE
    updateModeButtons()
  })
  btnExplore.addEventListener('click', () => {
    brushMode = EXPLORED
    updateModeButtons()
  })

  // Radius slider
  const rangeRadius = document.getElementById('range-radius') as HTMLInputElement
  const valRadius = document.getElementById('val-radius')!
  rangeRadius.addEventListener('input', () => {
    brushRadius = parseInt(rangeRadius.value, 10)
    valRadius.textContent = String(brushRadius)
  })

  // Preset buttons
  document.getElementById('btn-all-visible')!.addEventListener('click', presetAllVisible)
  document.getElementById('btn-all-explored')!.addEventListener('click', presetAllExplored)
  document.getElementById('btn-all-hidden')!.addEventListener('click', presetAllHidden)
  document.getElementById('btn-circular')!.addEventListener('click', presetCircular)

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    // Ignore when user is typing in an input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

    switch (e.key) {
      case '1':
        brushMode = VISIBLE
        updateModeButtons()
        break
      case '2':
        brushMode = EXPLORED
        updateModeButtons()
        break
      case 'r':
      case 'R':
        presetAllHidden()
        break
      case 'a':
      case 'A':
        presetAllVisible()
        break
      case 'e':
      case 'E':
        presetAllExplored()
        break
      case 'c':
      case 'C':
        presetCircular()
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

// Initialize with all-hidden state (opaque black overlay over entire terrain)
presetAllHidden()

engine.runRenderLoop(() => {
  scene.render()
  updateInfoBar(engine)
})

window.addEventListener('resize', () => {
  engine.resize()
})

// Expose for test harness / dev tools
;(window as unknown as Record<string, unknown>).__shroudOverlayTest = {
  visibilityData,
  dirtyCells,
  engine,
  scene,
  getStateCounts: countStates,
  presetAllVisible,
  presetAllExplored,
  presetAllHidden,
  presetCircular,
  applyRadius,
  setBrushMode: (mode: number) => {
    brushMode = mode
  },
  setBrushRadius: (r: number) => {
    brushRadius = r
  },
  getBrushMode: () => brushMode,
  getBrushRadius: () => brushRadius,
}
