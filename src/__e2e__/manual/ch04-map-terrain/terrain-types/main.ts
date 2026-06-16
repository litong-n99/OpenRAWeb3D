/**
 * TerrainInfo / TileSet Acceptance Test — terrain type colors and classification
 *
 * Loads a sample C&C TD-style tileset, displays terrain type color swatches,
 * template tile details, and renders a 3D color grid of tiles.
 *
 * OpenRA 对照: TerrainInfo.ts (TerrainTypeInfo, TerrainTileInfo, TileSet)
 */

import {
  Engine,
  Scene,
  ArcRotateCamera,
  Vector3,
  Color3,
  Color4,
  MeshBuilder,
  StandardMaterial,
} from '@babylonjs/core'
import {
  TileSet,
  colorToComponents,
  TerrainTile,
} from '../../../../OpenRA.Game/Map/TerrainInfo'
import type { TileSetJson } from '../../../../OpenRA.Game/Map/TerrainInfo'

// ---------------------------------------------------------------------------
// Sample tileset JSON (mimics C&C TD terrain)
// ---------------------------------------------------------------------------

const SAMPLE_TILESET: TileSetJson = {
  terrainTypes: [
    { type: 'Clear',       targetTypes: [],           acceptsSmudgeType: [],   color: '#90EE90' },  // Light green
    { type: 'Rough',       targetTypes: [],           acceptsSmudgeType: [],   color: '#D2B48C' },  // Tan
    { type: 'Road',        targetTypes: [],           acceptsSmudgeType: [],   color: '#708090' },  // Slate gray
    { type: 'Water',       targetTypes: [],           acceptsSmudgeType: [],   color: '#4169E1' },  // Royal blue
    { type: 'Rock',        targetTypes: [],           acceptsSmudgeType: [],   color: '#808080' },  // Gray
    { type: 'Wall',        targetTypes: [],           acceptsSmudgeType: [],   color: '#A0522D' },  // Sienna
    { type: 'Tiberium',    targetTypes: [],           acceptsSmudgeType: [],   color: '#00FF7F' },  // Spring green
    { type: 'Beach',       targetTypes: [],           acceptsSmudgeType: [],   color: '#F5DEB3' },  // Wheat
    { type: 'River',       targetTypes: [],           acceptsSmudgeType: [],   color: '#1E90FF' },  // Dodger blue
    { type: 'Cliff',       targetTypes: [],           acceptsSmudgeType: [],   color: '#A9A9A9' },  // Dark gray
  ],
  templates: [
    {
      id: 0,
      size: { x: 1, y: 1 },
      pickAny: false,
      categories: ['System'],
      tiles: [
        { terrainType: 'Clear', height: 0, rampType: 0, minColor: '#88E088', maxColor: '#98F898' },
      ],
    },
    {
      id: 1,
      size: { x: 1, y: 1 },
      pickAny: false,
      categories: ['System'],
      tiles: [
        { terrainType: 'Clear', height: 0, rampType: 0 },
      ],
    },
    {
      id: 2,
      size: { x: 1, y: 1 },
      pickAny: false,
      categories: ['System'],
      tiles: [
        { terrainType: 'Rough', height: 0, rampType: 0, minColor: '#CAAA80', maxColor: '#DAB890' },
      ],
    },
    {
      id: 3,
      size: { x: 1, y: 1 },
      pickAny: false,
      categories: ['System'],
      tiles: [
        { terrainType: 'Road', height: 0, rampType: 0 },
      ],
    },
    {
      id: 4,
      size: { x: 1, y: 1 },
      pickAny: false,
      categories: ['Water'],
      tiles: [
        { terrainType: 'Water', height: 0, rampType: 0, minColor: '#3060D0', maxColor: '#5070F0' },
      ],
    },
    {
      id: 5,
      size: { x: 1, y: 1 },
      pickAny: false,
      categories: ['Rock'],
      tiles: [
        { terrainType: 'Rock', height: 2, rampType: 5, minColor: '#707070', maxColor: '#909090' },
      ],
    },
    {
      id: 10,
      size: { x: 1, y: 1 },
      pickAny: false,
      categories: ['Cliff'],
      tiles: [
        { terrainType: 'Cliff', height: 1, rampType: 0, riser: 'LD=4' },
      ],
    },
    {
      id: 20,
      size: { x: 1, y: 1 },
      pickAny: false,
      categories: ['Tiberium'],
      tiles: [
        { terrainType: 'Tiberium', height: 0, rampType: 0, minColor: '#00EE70', maxColor: '#00FF90' },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// DOM elements
// ---------------------------------------------------------------------------

const sandbox = document.getElementById('sandbox') as HTMLDivElement
const gpuError = document.getElementById('gpu-error') as HTMLDivElement

// ---------------------------------------------------------------------------
// Babylon.js init
// ---------------------------------------------------------------------------

const canvas = document.createElement('canvas')
canvas.style.width = '100%'
canvas.style.height = '100%'
canvas.style.outline = 'none'
canvas.style.touchAction = 'none'
sandbox.appendChild(canvas)

// Match WebGL drawing buffer to actual display size.
const rect = sandbox.getBoundingClientRect()
canvas.width = rect.width
canvas.height = rect.height

console.log('[DEBUG] sandbox offset:', sandbox.offsetWidth, sandbox.offsetHeight)
console.log('[DEBUG] canvas intrinsic:', canvas.width, canvas.height)

const engine = new Engine(canvas, true, {
  preserveDrawingBuffer: true,
  stencil: true,
})

if (typeof WebGLRenderingContext === 'undefined') {
  gpuError.style.display = 'flex'
}

const scene = new Scene(engine)
scene.clearColor = new Color4(0.08, 0.09, 0.14, 1.0)

console.log('[DEBUG] engine ready:', (engine as any).isReady)
window.addEventListener('error', (e) => console.error('[DEBUG] Global error:', e.message, e.error))
window.addEventListener('unhandledrejection', (e) => console.error('[DEBUG] Unhandled rejection:', (e as any).reason))

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

const camera = new ArcRotateCamera(
  'camera',
  Math.PI / 4,
  Math.PI / 4,
  25,
  new Vector3(0, 0, 0),
  scene,
)
camera.lowerRadiusLimit = 5
camera.upperRadiusLimit = 100
camera.attachControl(canvas, true)

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------
// Use disableLighting=true + emissiveColor to render exact tileset colors.
// This is the same proven pattern used in cell-ramp-visual.
// diffuseColor + ambientColor setup produced white planes in this
// Babylon.js version/configuration despite correct math on paper.

// ---------------------------------------------------------------------------
// Load tileset
// ---------------------------------------------------------------------------

TileSet.fromJSON(SAMPLE_TILESET)

// ---------------------------------------------------------------------------
// Render terrain type color grid in 3D
// ---------------------------------------------------------------------------

const terrainTypesArr = Array.from(TileSet.terrainTypes.values())

console.log('[DEBUG] terrainTypes count:', terrainTypesArr.length)
console.log('[DEBUG] scene ambientColor:', scene.ambientColor)
const gridSize = Math.ceil(Math.sqrt(terrainTypesArr.length))
const cellSize = 1.2

for (let i = 0; i < terrainTypesArr.length; i++) {
  const tt = terrainTypesArr[i]!
  const col = i % gridSize
  const row = Math.floor(i / gridSize)

  const [a, r, g, b] = colorToComponents(tt.color)

  const plane = MeshBuilder.CreatePlane(`terrain-${tt.type}`, {
    width: 1,
    height: 1,
  }, scene)
  plane.position = new Vector3(
    (col - (gridSize - 1) / 2) * cellSize,
    0.01,
    (row - (gridSize - 1) / 2) * cellSize,
  )
  // In Babylon.js left-handed coords, +PI/2 turns the +Z-normal plane to face +Y (up).
  plane.rotation.x = Math.PI / 2

  const mat = new StandardMaterial(`mat-${tt.type}`, scene)
  mat.disableLighting = true
  mat.emissiveColor = new Color3(r / 255, g / 255, b / 255)
  mat.alpha = a / 255
  plane.material = mat

  if (i === 0) {
    console.log('[DEBUG] first plane name:', plane.name)
    console.log('[DEBUG] first plane position:', plane.position)
    console.log('[DEBUG] first mat diffuse:', mat.diffuseColor)
    console.log('[DEBUG] first mat ambient:', mat.ambientColor)
    console.log('[DEBUG] first mat alpha:', mat.alpha)
  }
}

// Ground plane
const ground = MeshBuilder.CreatePlane('ground', { width: gridSize * cellSize * 1.3, height: gridSize * cellSize * 1.3 }, scene)
ground.position.y = -0.05
// In Babylon.js left-handed coords, +PI/2 turns the +Z-normal plane to face +Y (up).
ground.rotation.x = Math.PI / 2
const groundMat = new StandardMaterial('groundMat', scene)
groundMat.disableLighting = true
groundMat.emissiveColor = new Color3(0.05, 0.06, 0.09)
ground.material = groundMat

console.log('[DEBUG] total meshes:', scene.meshes.length)
console.log('[DEBUG] camera position:', camera.position)
console.log('[DEBUG] camera target:', camera.target)
scene.meshes.forEach((m, idx) => {
  if (idx < 3) console.log('[DEBUG] mesh', idx, m.name, 'pos:', m.position, 'mat:', m.material?.name)
})

// ---------------------------------------------------------------------------
// Populate terrain type list in side panel
// ---------------------------------------------------------------------------

const terrainList = document.getElementById('terrain-list')!

for (const tt of terrainTypesArr) {
  const [, r, g, b] = colorToComponents(tt.color)
  const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase()
  const div = document.createElement('div')
  div.className = 'terrain-item'
  div.innerHTML = `
    <div class="terrain-swatch" style="background:${hex};"></div>
    <div>
      <div class="terrain-name">${tt.type}</div>
      <div class="terrain-hex">${hex}</div>
      ${tt.restrictPlayerColor ? '<span class="badge">NO PLAYER COLOR</span>' : ''}
    </div>
  `
  terrainList.appendChild(div)
}

// ---------------------------------------------------------------------------
// Populate template tile details
// ---------------------------------------------------------------------------

const templateTilesEl = document.getElementById('template-tiles')!

function renderTemplateTiles(): void {
  templateTilesEl.innerHTML = ''
  const tilesArr = Array.from(TileSet.tiles.entries())
  for (const [key, tileInfo] of tilesArr) {
    const templateId = (key >> 8) & 0xffff
    const tileIdx = key & 0xff
    const color = tileInfo.getColor(Math.random())
    const [, r, g, b] = colorToComponents(color)
    const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase()

    const hasRiser = Array.from(tileInfo.riser.values).some(v => v !== 0xFF)

    const div = document.createElement('div')
    div.className = 'tile-item'
    div.innerHTML = `
      <div class="tile-swatch" style="background:${hex};"></div>
      <span>Tpl#${templateId}[${tileIdx}]</span>
      <span class="badge">h=${tileInfo.height}</span>
      <span class="badge">ramp=${tileInfo.rampType}</span>
      ${hasRiser ? '<span class="badge">riser</span>' : ''}
      <span style="color:#666;font-size:10px;">${hex}</span>
    `
    templateTilesEl.appendChild(div)
  }
}

renderTemplateTiles()

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

let rampedCount = 0
for (const [, tileInfo] of TileSet.tiles) {
  if (tileInfo.rampType !== 0) rampedCount++
}

document.getElementById('stat-types')!.textContent = `${TileSet.terrainTypes.size}`
document.getElementById('stat-templates')!.textContent = `${SAMPLE_TILESET.templates.length}`
document.getElementById('stat-tiles')!.textContent = `${TileSet.tiles.size}`
document.getElementById('stat-ramped')!.textContent = `${rampedCount}`

// ---------------------------------------------------------------------------
// Randomize colors button
// ---------------------------------------------------------------------------

document.getElementById('randomize-colors')!.addEventListener('click', () => {
  renderTemplateTiles()
})

// ---------------------------------------------------------------------------
// Info bar
// ---------------------------------------------------------------------------

function updateInfoBar(): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.slice(0, 80)
  document.getElementById('info-viewport')!.textContent = `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}x`
  const glVer = (engine as any).webGLVersion ?? '2'
  document.getElementById('info-engine')!.textContent = `WebGL ${glVer}.0`
  document.getElementById('info-time')!.textContent = new Date().toISOString()
}

updateInfoBar()

// ---------------------------------------------------------------------------
// RAF loop
// ---------------------------------------------------------------------------

engine.runRenderLoop(() => {
  scene.render()
  const frameId = (engine as any).getFrameId?.() ?? 0
  if (frameId % 60 === 1) {
    console.log('[DEBUG] frame', frameId, 'meshes:', scene.meshes.length)
  }
  document.getElementById('info-fps')!.textContent = `${engine.getFps().toFixed(1)}`
})

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

engine.resize()

window.addEventListener('resize', () => {
  engine.resize()
  updateInfoBar()
})

// Expose key classes to global window for console debugging (step 4.4 in README)
;(window as any).TileSet = TileSet
;(window as any).TerrainTile = TerrainTile
