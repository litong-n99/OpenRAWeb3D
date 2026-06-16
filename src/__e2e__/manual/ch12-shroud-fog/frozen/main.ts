/**
 * shroud/frozen/main.ts — Frozen Actors Under Fog visual acceptance test
 *
 * Verifies:
 * 1. Buildings in fog/Explored area render at reduced opacity (alpha ~0.5)
 * 2. Frozen buildings use desaturated/gray-tinted material
 * 3. When fog clears, frozen snapshot replaced by live building
 * 4. Multiple frozen buildings tracked independently per player
 *
 * Architecture mirrors FrozenUnderFog:
 *   - Live building: StandardMaterial with full color (alpha=1.0)
 *   - Frozen building: StandardMaterial with desaturated + alpha=0.5
 *   - Hidden building: mesh.isVisible = false
 *   - Visibility determined by cell state under building footprint
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
// Visibility Data
// ---------------------------------------------------------------------------

const visibilityData = new Uint8Array(TOTAL_CELLS)

function cellIndex(col: number, row: number): number {
  return row * GRID_WIDTH + col
}

function isValidCell(col: number, row: number): boolean {
  return col >= 0 && col < GRID_WIDTH && row >= 0 && row < GRID_HEIGHT
}

function getCellState(col: number, row: number): number {
  if (!isValidCell(col, row)) return HIDDEN
  return visibilityData[cellIndex(col, row)]
}

// ---------------------------------------------------------------------------
// Building Data
// ---------------------------------------------------------------------------

interface BuildingInfo {
  name: string
  gridCol: number  // center cell
  gridRow: number
  color: Color3    // live color
  mesh: AbstractMesh
  frozenClone: AbstractMesh | null
  health: number    // 0-1
}

const buildings: BuildingInfo[] = [
  {
    name: 'A1', gridCol: 2, gridRow: 2,
    color: new Color3(0.9, 0.45, 0.1), // orange (power plant)
    mesh: null as unknown as AbstractMesh,
    frozenClone: null,
    health: 1.0,
  },
  {
    name: 'B1', gridCol: 7, gridRow: 2,
    color: new Color3(0.2, 0.5, 0.9), // blue (barracks)
    mesh: null as unknown as AbstractMesh,
    frozenClone: null,
    health: 1.0,
  },
  {
    name: 'C1', gridCol: 2, gridRow: 7,
    color: new Color3(0.3, 0.8, 0.3), // green (supply)
    mesh: null as unknown as AbstractMesh,
    frozenClone: null,
    health: 1.0,
  },
  {
    name: 'D1', gridCol: 7, gridRow: 7,
    color: new Color3(0.8, 0.3, 0.5), // pink (tech center)
    mesh: null as unknown as AbstractMesh,
    frozenClone: null,
    health: 1.0,
  },
]

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
      const state = visibilityData[cellIndex(col, row)]
      if (state === VISIBLE) continue
      const px = col * CELL_PX
      const py = row * CELL_PX
      const c = stateToRGBA(state)
      ctx.fillStyle = rgbaToCSS(c)
      ctx.fillRect(px, py, CELL_PX, CELL_PX)
    }
  }

  // Edge blending
  const EDGE = 4, EH = EDGE / 2
  for (let row = 0; row < GRID_HEIGHT; row++) {
    for (let col = 0; col < GRID_WIDTH; col++) {
      const state = visibilityData[cellIndex(col, row)]
      if (state === VISIBLE) continue

      if (col + 1 < GRID_WIDTH) {
        const rs = visibilityData[cellIndex(col + 1, row)]
        if (state !== rs) {
          const gx = (col + 1) * CELL_PX - EH, gy = row * CELL_PX
          const grad = ctx.createLinearGradient(gx, 0, gx + EDGE, 0)
          grad.addColorStop(0, rgbaToCSS(stateToRGBA(state)))
          grad.addColorStop(1, rgbaToCSS(stateToRGBA(rs)))
          ctx.fillStyle = grad
          ctx.fillRect(gx, gy, EDGE, CELL_PX)
        }
      }
      if (row + 1 < GRID_HEIGHT) {
        const bs = visibilityData[cellIndex(col, row + 1)]
        if (state !== bs) {
          const gx = col * CELL_PX, gy = (row + 1) * CELL_PX - EH
          const grad = ctx.createLinearGradient(0, gy, 0, gy + EDGE)
          grad.addColorStop(0, rgbaToCSS(stateToRGBA(state)))
          grad.addColorStop(1, rgbaToCSS(stateToRGBA(bs)))
          ctx.fillStyle = grad
          ctx.fillRect(gx, gy, CELL_PX, EDGE)
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
// Building Visibility Update
// ---------------------------------------------------------------------------

/**
 * Update each building's visual state based on the cell visibility at its position.
 *
 * Visible cell → live mesh visible (alpha=1.0, full color)
 * Explored cell → frozen clone visible (alpha=0.5, desaturated), live mesh hidden
 * Hidden cell → both meshes hidden
 */
function updateBuildingVisibility(): void {
  for (const b of buildings) {
    const state = getCellState(b.gridCol, b.gridRow)

    if (state === VISIBLE) {
      // Live — full opacity, full color
      b.mesh.isVisible = true
      const mat = b.mesh.material as StandardMaterial
      mat.alpha = 1.0
      mat.diffuseColor = b.color
      // Apply health damage tint
      if (b.health < 1.0) {
        mat.diffuseColor = new Color3(
          b.color.r * (0.3 + 0.7 * b.health),
          b.color.g * (0.3 + 0.7 * b.health),
          b.color.b * (0.3 + 0.7 * b.health),
        )
      }

      if (b.frozenClone) b.frozenClone.isVisible = false
    } else if (state === EXPLORED) {
      // Frozen — reduced alpha + desaturated
      b.mesh.isVisible = false

      if (!b.frozenClone) {
        b.frozenClone = createFrozenClone(b)
      }
      b.frozenClone.isVisible = true

      // Apply health damage to frozen (darker version)
      const fmat = b.frozenClone.material as StandardMaterial
      const gray = 0.35 * (0.3 + 0.7 * b.health)
      fmat.diffuseColor = new Color3(gray, gray, gray)
      fmat.alpha = 0.5
    } else {
      // Hidden
      b.mesh.isVisible = false
      if (b.frozenClone) b.frozenClone.isVisible = false
    }
  }

  updateStatusPanel()
}

function createFrozenClone(b: BuildingInfo): AbstractMesh {
  // Create a clone mesh at same position with desaturated/gray material
  const scene = b.mesh._scene
  const clone = MeshBuilder.CreateBox(`frozen_${b.name}`, { width: 0.55, height: 0.4, depth: 0.55 }, scene)
  clone.position.copyFrom(b.mesh.position)
  clone.rotation.copyFrom(b.mesh.rotation)

  const mat = new StandardMaterial(`frozenMat_${b.name}`, scene)
  mat.diffuseColor = new Color3(0.35, 0.35, 0.35)
  mat.alpha = 0.5
  mat.specularColor = new Color3(0, 0, 0)
  clone.material = mat

  return clone
}

// ---------------------------------------------------------------------------
// Status Panel
// ---------------------------------------------------------------------------

function updateStatusPanel(): void {
  for (const b of buildings) {
    const el = document.getElementById(`status-${b.name.toLowerCase()}`)!
    const state = getCellState(b.gridCol, b.gridRow)
    const hp = Math.round(b.health * 100)
    if (state === VISIBLE) {
      el.className = 'live'
      el.textContent = `Live (HP:${hp}%) alpha=1.0`
    } else if (state === EXPLORED) {
      el.className = 'frozen'
      el.textContent = `Frozen (HP:${hp}%) alpha=0.5 desat`
    } else {
      el.className = 'hidden'
      el.textContent = `Hidden (HP:${hp}%) invisible`
    }
  }
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

function presetAllVisible(): void {
  visibilityData.fill(VISIBLE)
  updateShroudTexture()
  updateBuildingVisibility()
}

function presetPartialFog(): void {
  // Left half visible (cols 0-4), right half explored (cols 5-9)
  for (let row = 0; row < GRID_HEIGHT; row++) {
    for (let col = 0; col < GRID_WIDTH; col++) {
      visibilityData[cellIndex(col, row)] = col < 5 ? VISIBLE : EXPLORED
    }
  }
  updateShroudTexture()
  updateBuildingVisibility()
}

function presetAllFog(): void {
  visibilityData.fill(EXPLORED)
  updateShroudTexture()
  updateBuildingVisibility()
}

function presetAllHidden(): void {
  visibilityData.fill(HIDDEN)
  updateShroudTexture()
  updateBuildingVisibility()
}

// ---------------------------------------------------------------------------
// Building Damage/Heal
// ---------------------------------------------------------------------------

function damageBuilding(b: BuildingInfo, amount: number): void {
  b.health = Math.max(0, b.health - amount)
  updateBuildingVisibility()
}

function healAll(): void {
  for (const b of buildings) {
    b.health = 1.0
  }
  updateBuildingVisibility()
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

function setupScene(): { engine: Engine; scene: Scene } {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false })
  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.12, 0.14, 0.18, 1)

  const camera = new ArcRotateCamera(
    'camera',
    -Math.PI / 4, Math.PI / 3.2, 12,
    new Vector3(GRID_WORLD_W / 2, 0, GRID_WORLD_H / 2),
    scene,
  )
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 2
  camera.upperRadiusLimit = 30

  new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)
  new HemisphericLight('fill', new Vector3(-0.3, 0.5, -0.5), scene).intensity = 0.3

  // Terrain
  const terrainTexRes = 500
  const terrainTex = new DynamicTexture('terrainTex', { width: terrainTexRes, height: terrainTexRes / 2 }, scene, false)
  const tctx = terrainTex.getContext() as CanvasRenderingContext2D
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 10; col++) {
      tctx.fillStyle = (row + col) % 2 === 0 ? '#1a5c1a' : '#2a7c2a'
      tctx.fillRect(col * (terrainTexRes / 10), row * (terrainTexRes / 10), terrainTexRes / 10, terrainTexRes / 10)
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

  // Create building meshes
  for (const b of buildings) {
    const worldX = b.gridCol * CELL_SIZE + CELL_SIZE / 2
    const worldZ = b.gridRow * CELL_SIZE + CELL_SIZE / 2

    const box = MeshBuilder.CreateBox(`building_${b.name}`, { width: 0.6, height: 0.45, depth: 0.6 }, scene)
    box.position = new Vector3(worldX, 0.225, worldZ)
    const mat = new StandardMaterial(`mat_${b.name}`, scene)
    mat.diffuseColor = b.color
    mat.specularColor = new Color3(0.1, 0.1, 0.1)
    box.material = mat
    b.mesh = box
  }

  return { engine, scene }
}

// ---------------------------------------------------------------------------
// UI Controls
// ---------------------------------------------------------------------------

function setupControls(): void {
  document.getElementById('btn-all-visible')!.addEventListener('click', presetAllVisible)
  document.getElementById('btn-partial-fog')!.addEventListener('click', presetPartialFog)
  document.getElementById('btn-all-fog')!.addEventListener('click', presetAllFog)
  document.getElementById('btn-all-hidden')!.addEventListener('click', presetAllHidden)
  document.getElementById('btn-damage-b1')!.addEventListener('click', () => {
    damageBuilding(buildings[1], 0.4)
  })
  document.getElementById('btn-heal-all')!.addEventListener('click', healAll)

  window.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'v': case 'V': presetAllVisible(); break
      case 'f': case 'F': presetAllFog(); break
      case 'h': case 'H': presetAllHidden(); break
      case 'p': case 'P': presetPartialFog(); break
    }
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { engine, scene } = setupScene()
setupControls()

// Start with all visible to show live buildings
presetAllVisible()

engine.runRenderLoop(() => {
  scene.render()
  updateInfoBar(engine)
})

window.addEventListener('resize', () => { engine.resize() })

;(window as unknown as Record<string, unknown>).__shroudFrozenTest = {
  visibilityData,
  buildings,
  engine,
  scene,
  presetAllVisible,
  presetPartialFog,
  presetAllFog,
  presetAllHidden,
  damageBuilding,
  healAll,
}
