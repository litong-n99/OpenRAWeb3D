/**
 * shroud/reveal-map/main.ts — Full Map Reveal visual acceptance test
 *
 * Verifies:
 * 1. With RevealMap disabled: unexplored areas show shroud (black/Hidden)
 * 2. With RevealMap enabled: entire map becomes Explored (dim/fog) — terrain visible, no live units
 * 3. With RevealMap disabled again: map returns to PREVIOUS shroud state
 *    (previously explored areas remain explored, NOT all black)
 * 4. Units revealed by RevealMap are in fog state (frozen/static), not live-updating
 *
 * Architecture mirrors RevealsMap trait:
 *   - When enabled: all cells temporarily set to EXPLORED
 *   - When disabled: restore each cell to its previous visibility state
 *   - Units: visible only in Visible cells; in Explored cells they show frozen state
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
  type AbstractMesh,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Grid Configuration
// ---------------------------------------------------------------------------

const GRID_WIDTH = 10
const GRID_HEIGHT = 10
const CELL_SIZE = 0.8
const TOTAL_CELLS = GRID_WIDTH * GRID_HEIGHT
const GRID_WORLD_W = GRID_WIDTH * CELL_SIZE
const GRID_WORLD_H = GRID_HEIGHT * CELL_SIZE

const TEX_RES = 500
const CELL_PX = TEX_RES / GRID_WIDTH

const HIDDEN = 0
const EXPLORED = 1
const VISIBLE = 2

// ---------------------------------------------------------------------------
// Three visibility layers:
//   baseState: the "real" state per cell (what would be without RevealMap)
//   revealed: whether RevealMap is active
//   effectiveState(col, row): what we actually render
// ---------------------------------------------------------------------------

const baseState = new Uint8Array(TOTAL_CELLS)
baseState.fill(HIDDEN)

let revealMapEnabled = false

// Track cells that were explored *before* RevealMap was toggled
// (these should survive a RevealMap-toggle cycle)
let previouslyExplored = new Set<number>()

function cellIndex(col: number, row: number): number {
  return row * GRID_WIDTH + col
}

function effectiveState(col: number, row: number): number {
  if (!isValidCell(col, row)) return HIDDEN
  const idx = cellIndex(col, row)
  if (revealMapEnabled) {
    // RevealMap: forced Explored for all cells
    return EXPLORED
  }
  return baseState[idx]
}

function isValidCell(col: number, row: number): boolean {
  return col >= 0 && col < GRID_WIDTH && row >= 0 && row < GRID_HEIGHT
}

// ---------------------------------------------------------------------------
// Unit Data (static buildings)
// ---------------------------------------------------------------------------

interface UnitInfo {
  name: string
  gridCol: number
  gridRow: number
  mesh: AbstractMesh
  frozenClone: AbstractMesh | null
}

const units: UnitInfo[] = []

// ---------------------------------------------------------------------------
// Shroud Texture
// ---------------------------------------------------------------------------

let dynamicTexture: DynamicTexture | null = null

function stateToRGBA(state: number): { r: number; g: number; b: number; a: number } {
  switch (state) {
    case HIDDEN:  return { r: 0, g: 0, b: 0, a: 1.0 }
    case EXPLORED: return { r: 15, g: 15, b: 15, a: 0.55 }
    case VISIBLE:  return { r: 0, g: 0, b: 0, a: 0.0 }
    default:       return { r: 0, g: 0, b: 0, a: 1.0 }
  }
}

function rgbaToCSS(c: { r: number; g: number; b: number; a: number }): string {
  return `rgba(${c.r},${c.g},${c.b},${c.a})`
}

function drawShroudOverlay(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, TEX_RES, TEX_RES)
  for (let row = 0; row < GRID_HEIGHT; row++) {
    for (let col = 0; col < GRID_WIDTH; col++) {
      const state = effectiveState(col, row)
      if (state === VISIBLE) continue
      const px = col * CELL_PX, py = row * CELL_PX
      ctx.fillStyle = rgbaToCSS(stateToRGBA(state))
      ctx.fillRect(px, py, CELL_PX, CELL_PX)
    }
  }

  // Edge blending
  const EDGE = 4, EH = EDGE / 2
  for (let row = 0; row < GRID_HEIGHT; row++) {
    for (let col = 0; col < GRID_WIDTH; col++) {
      const state = effectiveState(col, row)
      if (state === VISIBLE) continue
      if (col + 1 < GRID_WIDTH) {
        const rs = effectiveState(col + 1, row)
        if (state !== rs) {
          const gx = (col + 1) * CELL_PX - EH, gy = row * CELL_PX
          const grad = ctx.createLinearGradient(gx, 0, gx + EDGE, 0)
          grad.addColorStop(0, rgbaToCSS(stateToRGBA(state)))
          grad.addColorStop(1, rgbaToCSS(stateToRGBA(rs)))
          ctx.fillStyle = grad; ctx.fillRect(gx, gy, EDGE, CELL_PX)
        }
      }
      if (row + 1 < GRID_HEIGHT) {
        const bs = effectiveState(col + 1, row + 1)
        void bs // unused in vertical check below — re-fetch
        const vs = effectiveState(col, row + 1)
        if (state !== vs) {
          const gx = col * CELL_PX, gy = (row + 1) * CELL_PX - EH
          const grad = ctx.createLinearGradient(0, gy, 0, gy + EDGE)
          grad.addColorStop(0, rgbaToCSS(stateToRGBA(state)))
          grad.addColorStop(1, rgbaToCSS(stateToRGBA(vs)))
          ctx.fillStyle = grad; ctx.fillRect(gx, gy, CELL_PX, EDGE)
        }
      }
    }
  }
}

function updateShroudTexture(): void {
  if (!dynamicTexture) return
  const ctx = dynamicTexture.getContext() as CanvasRenderingContext2D
  drawShroudOverlay(ctx)
  dynamicTexture.update(false)
}

// ---------------------------------------------------------------------------
// Unit Visibility
// ---------------------------------------------------------------------------

function updateUnitVisibility(): void {
  for (const u of units) {
    const state = effectiveState(u.gridCol, u.gridRow)

    if (state === VISIBLE) {
      u.mesh.isVisible = true
      const mat = u.mesh.material as StandardMaterial
      mat.alpha = 1.0
      if (u.frozenClone) u.frozenClone.isVisible = false
    } else if (state === EXPLORED) {
      // Fog: show frozen clone at reduced opacity
      u.mesh.isVisible = false
      if (!u.frozenClone) {
        u.frozenClone = createFrozenClone(u)
      }
      u.frozenClone.isVisible = true
    } else {
      // Hidden
      u.mesh.isVisible = false
      if (u.frozenClone) u.frozenClone.isVisible = false
    }
  }
}

function createFrozenClone(u: UnitInfo): AbstractMesh {
  const scene = u.mesh._scene
  const clone = MeshBuilder.CreateBox(`frozen_${u.name}`, { width: 0.5, height: 0.35, depth: 0.5 }, scene)
  clone.position.copyFrom(u.mesh.position)
  const mat = new StandardMaterial(`frozenMat_${u.name}`, scene)
  mat.diffuseColor = new Color3(0.35, 0.35, 0.35)
  mat.alpha = 0.5
  mat.specularColor = new Color3(0, 0, 0)
  clone.material = mat
  return clone
}

// ---------------------------------------------------------------------------
// RevealMap Toggle
// ---------------------------------------------------------------------------

function toggleRevealMap(): void {
  if (!revealMapEnabled) {
    // ENABLING: save which cells are currently explored
    previouslyExplored = new Set<number>()
    for (let i = 0; i < TOTAL_CELLS; i++) {
      if (baseState[i] >= EXPLORED) {
        previouslyExplored.add(i)
      }
    }
    revealMapEnabled = true
  } else {
    // DISABLING: restore base state
    revealMapEnabled = false
  }

  updateShroudTexture()
  updateUnitVisibility()
  updateUIState()
}

// ---------------------------------------------------------------------------
// Presets — modify baseState
// ---------------------------------------------------------------------------

function exploreCorners(): void {
  // Explore 4 corners (3x3 regions)
  const regions = [
    { c: 0, r: 0 }, { c: 7, r: 0 },
    { c: 0, r: 7 }, { c: 7, r: 7 },
  ]
  for (const reg of regions) {
    for (let row = reg.r; row < reg.r + 3 && row < GRID_HEIGHT; row++) {
      for (let col = reg.c; col < reg.c + 3 && col < GRID_WIDTH; col++) {
        baseState[cellIndex(col, row)] = EXPLORED
      }
    }
  }
  // Set center cells of each corner to VISIBLE
  for (const reg of regions) {
    if (isValidCell(reg.c + 1, reg.r + 1)) {
      baseState[cellIndex(reg.c + 1, reg.r + 1)] = VISIBLE
    }
  }
  updateShroudTexture()
  updateUnitVisibility()
}

function exploreCenter(): void {
  // Center 4x4 area = VISIBLE, surrounding band = EXPLORED
  for (let row = 0; row < GRID_HEIGHT; row++) {
    for (let col = 0; col < GRID_WIDTH; col++) {
      const idx = cellIndex(col, row)
      const dx = col - GRID_WIDTH / 2 + 0.5
      const dy = row - GRID_HEIGHT / 2 + 0.5
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist <= 2) baseState[idx] = VISIBLE
      else if (dist <= 3) baseState[idx] = EXPLORED
    }
  }
  updateShroudTexture()
  updateUnitVisibility()
}

function exploreStrip(): void {
  // Horizontal strip: rows 3-6 VISIBLE, rows 2 and 7 EXPLORED
  for (let row = 0; row < GRID_HEIGHT; row++) {
    for (let col = 0; col < GRID_WIDTH; col++) {
      const idx = cellIndex(col, row)
      if (row >= 3 && row <= 6) baseState[idx] = VISIBLE
      else if (row === 2 || row === 7) baseState[idx] = EXPLORED
    }
  }
  updateShroudTexture()
  updateUnitVisibility()
}

function resetAllHidden(): void {
  baseState.fill(HIDDEN)
  if (revealMapEnabled) {
    // Save nothing explored
    previouslyExplored = new Set<number>()
  }
  updateShroudTexture()
  updateUnitVisibility()
}

// ---------------------------------------------------------------------------
// UI State
// ---------------------------------------------------------------------------

function updateUIState(): void {
  const btn = document.getElementById('btn-reveal')!
  const stateEl = document.getElementById('state-reveal')!
  const exploredEl = document.getElementById('state-explored')!

  if (revealMapEnabled) {
    btn.textContent = 'Reveal Map (关闭)'
    btn.className = 'toggle-on'
    stateEl.textContent = 'Enabled (全图Explored)'
    stateEl.className = 'enabled'
  } else {
    btn.textContent = 'Reveal Map (开启)'
    btn.className = 'toggle-off'
    stateEl.textContent = 'Disabled'
    stateEl.className = 'disabled'
  }

  let exploredCount = 0
  for (let i = 0; i < TOTAL_CELLS; i++) {
    if (baseState[i] >= EXPLORED) exploredCount++
  }
  exploredEl.textContent = `${exploredCount} / ${TOTAL_CELLS} (先前: ${previouslyExplored.size})`
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

function countEffectiveStates(): { hidden: number; explored: number; visible: number } {
  let hidden = 0, explored = 0, visible = 0
  for (let row = 0; row < GRID_HEIGHT; row++) {
    for (let col = 0; col < GRID_WIDTH; col++) {
      switch (effectiveState(col, row)) {
        case HIDDEN: hidden++; break
        case EXPLORED: explored++; break
        case VISIBLE: visible++; break
      }
    }
  }
  return { hidden, explored, visible }
}

function updateInfoBar(engine: Engine): void {
  infoUa.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  infoViewport.textContent = `${window.innerWidth}x${window.innerHeight}`
  infoEngine.textContent = engine.webGLVersion === 2 ? 'WebGL 2.0' : 'WebGL 1.0'
  const counts = countEffectiveStates()
  infoHidden.textContent = String(counts.hidden)
  infoExplored.textContent = String(counts.explored)
  infoVisible.textContent = String(counts.visible)
  infoFps.textContent = String(Math.round(engine.getFps()))
  infoTime.textContent = new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Babylon.js Scene
// ---------------------------------------------------------------------------

function setupScene(): { engine: Engine; scene: Scene } {
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

  new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)

  // Terrain
  const terrainTex = new DynamicTexture('terrainTex', { width: 500, height: 250 }, scene, false)
  const tctx = terrainTex.getContext() as CanvasRenderingContext2D
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 10; col++) {
      tctx.fillStyle = (row + col) % 2 === 0 ? '#1a5c1a' : '#2a7c2a'
      tctx.fillRect(col * 50, row * 50, 50, 50)
    }
  }
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
  shroudPlane.position = new Vector3(GRID_WORLD_W / 2, 0.001, GRID_WORLD_H / 2)
  shroudPlane.material = shroudMat

  // Create two "unit" meshes (buildings)
  const unitPositions = [
    { name: 'U1', col: 3, row: 3, color: new Color3(0.9, 0.5, 0.1) },
    { name: 'U2', col: 6, row: 6, color: new Color3(0.3, 0.3, 0.9) },
  ]

  for (const up of unitPositions) {
    const worldX = up.col * CELL_SIZE + CELL_SIZE / 2
    const worldZ = up.row * CELL_SIZE + CELL_SIZE / 2
    const box = MeshBuilder.CreateBox(`unit_${up.name}`, { width: 0.55, height: 0.4, depth: 0.55 }, scene)
    box.position = new Vector3(worldX, 0.2, worldZ)
    const mat = new StandardMaterial(`unitMat_${up.name}`, scene)
    mat.diffuseColor = up.color
    mat.specularColor = new Color3(0.05, 0.05, 0.05)
    box.material = mat
    box.isVisible = false // initially hidden

    units.push({
      name: up.name,
      gridCol: up.col,
      gridRow: up.row,
      mesh: box,
      frozenClone: null,
    })
  }

  return { engine, scene }
}

// ---------------------------------------------------------------------------
// UI Controls
// ---------------------------------------------------------------------------

function setupControls(): void {
  document.getElementById('btn-reveal')!.addEventListener('click', toggleRevealMap)
  document.getElementById('btn-explore-corners')!.addEventListener('click', exploreCorners)
  document.getElementById('btn-explore-center')!.addEventListener('click', exploreCenter)
  document.getElementById('btn-explore-strip')!.addEventListener('click', exploreStrip)
  document.getElementById('btn-reset-all')!.addEventListener('click', resetAllHidden)

  window.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'r': case 'R': toggleRevealMap(); break
      case 'c': case 'C': exploreCorners(); break
      case 'e': case 'E': exploreCenter(); break
      case 's': case 'S': exploreStrip(); break
      case 'x': case 'X': resetAllHidden(); break
    }
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { engine, scene } = setupScene()
setupControls()

// Start with all hidden
updateShroudTexture()
updateUnitVisibility()
updateUIState()

engine.runRenderLoop(() => {
  scene.render()
  updateInfoBar(engine)
})

window.addEventListener('resize', () => { engine.resize() })

;(window as unknown as Record<string, unknown>).__revealMapTest = {
  baseState,
  revealMapEnabled,
  previouslyExplored,
  effectiveState,
  toggleRevealMap,
  exploreCorners,
  exploreCenter,
  exploreStrip,
  resetAllHidden,
  engine,
  scene,
  get revealMapOn() { return revealMapEnabled },
  units,
}
