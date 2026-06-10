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

const engine = new Engine(canvas, true, {
  preserveDrawingBuffer: true,
  stencil: true,
})

if (typeof WebGLRenderingContext === 'undefined') {
  gpuError.style.display = 'flex'
}

const scene = new Scene(engine)
scene.clearColor = new Color4(0.08, 0.09, 0.14, 1.0)

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
// Use scene.ambientColor as the sole light source. StandardMaterial's
// default ambientColor is White(1,1,1), so:
//   finalColor = diffuseColor * ambientColor * sceneAmbientColor
//              = c3 * White * White
//              = c3 (exact tileset color)
// No HemisphericLight needed; this avoids all normal-dependent lighting issues.
scene.ambientColor = Color3.White()

// ---------------------------------------------------------------------------
// Load tileset
// ---------------------------------------------------------------------------

TileSet.fromJSON(SAMPLE_TILESET)

// ---------------------------------------------------------------------------
// Render terrain type color grid in 3D
// ---------------------------------------------------------------------------

const terrainTypesArr = Array.from(TileSet.terrainTypes.values())
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
  plane.rotation.x = -Math.PI / 2

  const mat = new StandardMaterial(`mat-${tt.type}`, scene)
  // finalColor = diffuseColor * ambientColor(default White) * scene.ambientColor(White) = c3
  mat.diffuseColor = new Color3(r / 255, g / 255, b / 255)
  mat.alpha = a / 255
  plane.material = mat
}

// Ground plane
const ground = MeshBuilder.CreatePlane('ground', { width: gridSize * cellSize * 1.3, height: gridSize * cellSize * 1.3 }, scene)
ground.position.y = -0.05
ground.rotation.x = -Math.PI / 2
const groundMat = new StandardMaterial('groundMat', scene)
groundMat.diffuseColor = new Color3(0.05, 0.06, 0.09)
ground.material = groundMat

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

    const div = document.createElement('div')
    div.className = 'tile-item'
    div.innerHTML = `
      <div class="tile-swatch" style="background:${hex};"></div>
      <span>Tpl#${templateId}[${tileIdx}]</span>
      <span class="badge">h=${tileInfo.height}</span>
      <span class="badge">ramp=${tileInfo.rampType}</span>
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
  document.getElementById('info-fps')!.textContent = `${engine.getFps().toFixed(1)}`
})

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

window.addEventListener('resize', () => {
  engine.resize()
  updateInfoBar()
})
