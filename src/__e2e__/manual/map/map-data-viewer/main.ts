/**
 * Map Data Viewer Acceptance Test — visualize tile/resource/height data layers
 *
 * Creates a synthetic map with patterned terrain data, then renders each
 * cell as a colored 3D quad. Supports four view modes: tiles, resources,
 * height, and combined.
 *
 * OpenRA 对照: Map.ts (Map class, data layers, centerOfCell)
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
} from '@babylonjs/core'
import { Map } from '../../../../OpenRA.Game/Map/Map'
import { MapGrid } from '../../../../OpenRA.Game/Map/MapGrid'
import { MapGridType } from '../../../../OpenRA.Game/Map/MapGridType'
import { MPos } from '../../../../OpenRA.Game/MPos'
import type { ITerrainInfo } from '../../../../OpenRA.Game/Map/Map'
import type { Size } from '../../../../OpenRA.Game/Primitives/Size'
import type { TerrainTile } from '../../../../OpenRA.Game/Map/TileReference'
import {
  TileSet,
  TerrainTypeInfo,
  TerrainTile as TerrainTileClass,
} from '../../../../OpenRA.Game/Map/TerrainInfo'
import type { TerrainTileInfo } from '../../../../OpenRA.Game/Map/TerrainInfo'
import type { TileSetJson } from '../../../../OpenRA.Game/Map/TerrainInfo'

// ---------------------------------------------------------------------------
// Sample tileset (same as terrain-types test, for consistency)
// ---------------------------------------------------------------------------

const SAMPLE_TILESET: TileSetJson = {
  terrainTypes: [
    { type: 'Clear',    color: '#90EE90' },
    { type: 'Rough',    color: '#D2B48C' },
    { type: 'Road',     color: '#708090' },
    { type: 'Water',    color: '#4169E1' },
    { type: 'Rock',     color: '#808080' },
    { type: 'Wall',     color: '#A0522D' },
    { type: 'Tiberium', color: '#00FF7F' },
  ],
  templates: [
    { id: 0, size: { x: 1, y: 1 }, tiles: [{ terrainType: 'Clear', height: 0, rampType: 0 }] },
    { id: 1, size: { x: 1, y: 1 }, tiles: [{ terrainType: 'Rough', height: 0, rampType: 0 }] },
    { id: 2, size: { x: 1, y: 1 }, tiles: [{ terrainType: 'Road',  height: 0, rampType: 0 }] },
    { id: 3, size: { x: 1, y: 1 }, tiles: [{ terrainType: 'Water', height: 0, rampType: 0 }] },
    { id: 4, size: { x: 1, y: 1 }, tiles: [{ terrainType: 'Rock',  height: 2, rampType: 5 }] },
    { id: 5, size: { x: 1, y: 1 }, tiles: [{ terrainType: 'Wall',  height: 0, rampType: 0 }] },
    { id: 6, size: { x: 1, y: 1 }, tiles: [{ terrainType: 'Tiberium', height: 0, rampType: 0 }] },
  ],
}

// ---------------------------------------------------------------------------
// Load tileset
// ---------------------------------------------------------------------------

TileSet.fromJSON(SAMPLE_TILESET)

// ---------------------------------------------------------------------------
// Simple seeded PRNG (mulberry32)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// ITerrainInfo implementation wrapping TileSet
// ---------------------------------------------------------------------------

class TerrainInfoAdapter implements ITerrainInfo {
  readonly id = 'test-tileset'
  readonly terrainTypes: readonly TerrainTypeInfo[]
  readonly defaultTerrainTile: TerrainTile = { type: 0, index: 0 }

  constructor() {
    this.terrainTypes = Array.from(TileSet.terrainTypes.values())
  }

  getTerrainInfo(tile: TerrainTile): TerrainTileInfo {
    return TileSet.getTileInfo(new TerrainTileClass(tile.type, tile.index))
  }

  tryGetTerrainInfo(tile: TerrainTile): TerrainTileInfo | null {
    const key = ((tile.type & 0xffff) << 8) | (tile.index & 0xff)
    return TileSet.tiles.get(key) ?? null
  }

  getTerrainIndex(_tile: TerrainTile): number {
    const info = this.tryGetTerrainInfo(_tile)
    return info ? info.terrainType : 0
  }
}

// ---------------------------------------------------------------------------
// Map generation: create a synthetic map with interesting patterns
// ---------------------------------------------------------------------------

function generateMap(sizeCells: number, seed: number): Map {
  const terrainInfo = new TerrainInfoAdapter()
  const grid = new MapGrid({ type: MapGridType.Rectangular, maximumTerrainHeight: 2 })
  const sz: Size = { width: sizeCells, height: sizeCells }

  const map = Map.createBlank(grid, sz, terrainInfo)
  const rng = mulberry32(seed)

  const half = sizeCells / 2

  for (let x = 0; x < sizeCells; x++) {
    for (let y = 0; y < sizeCells; y++) {
      const uv = new MPos(x, y)

      // Distance from center
      const dx = x - half
      const dy = y - half
      const dist = Math.sqrt(dx * dx + dy * dy)
      const normDist = dist / (half * 0.9)

      // Determine terrain type
      let tileType: number
      const tileIndex = 0

      if (normDist < 0.25) {
        tileType = 3 // Water
        map.height.setMPos(uv, 0)
      } else if (normDist < 0.3) {
        tileType = 0 // Clear/beach
        map.height.setMPos(uv, 0)
      } else if (normDist < 0.6) {
        if (rng() < 0.7) {
          tileType = 0 // Clear
          map.height.setMPos(uv, 0)
        } else {
          tileType = 1 // Rough
          map.height.setMPos(uv, 1)
        }
      } else if (normDist < 0.8) {
        tileType = 4 // Rock
        map.height.setMPos(uv, 1 + Math.floor(rng() * 2))
      } else {
        tileType = rng() < 0.5 ? 0 : 1
        map.height.setMPos(uv, rng() < 0.3 ? 1 : 0)
      }

      // Resource deposits (tiberium)
      if (normDist > 0.35 && normDist < 0.7 && rng() < 0.15) {
        map.resources.setMPos(uv, { type: 1, index: Math.floor(rng() * 10) + 1 })
      } else {
        map.resources.setMPos(uv, { type: 0, index: 0 })
      }

      map.tiles.setMPos(uv, { type: tileType, index: tileIndex })
    }
  }

  return map
}

// ---------------------------------------------------------------------------
// DOM elements
// ---------------------------------------------------------------------------

const sandbox = document.getElementById('sandbox') as HTMLDivElement
const gpuError = document.getElementById('gpu-error') as HTMLDivElement

// ---------------------------------------------------------------------------
// Babylon.js init
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// WebGL support check (must happen before Engine construction)
// ---------------------------------------------------------------------------

if (typeof WebGLRenderingContext === 'undefined') {
  gpuError.style.display = 'flex'
  throw new Error('WebGL is not available in this browser')
}

// ---------------------------------------------------------------------------
// Canvas + Engine init
// ---------------------------------------------------------------------------

const canvas = document.createElement('canvas')
canvas.style.width = '100%'
canvas.style.height = '100%'
canvas.style.outline = 'none'
canvas.style.touchAction = 'none'
sandbox.appendChild(canvas)

// Ensure the canvas has non-zero intrinsic size before Engine reads it.
const sandboxRect = sandbox.getBoundingClientRect()
canvas.width = Math.max(1, Math.floor(sandboxRect.width * window.devicePixelRatio))
canvas.height = Math.max(1, Math.floor(sandboxRect.height * window.devicePixelRatio))

const engine = new Engine(canvas, true, {
  preserveDrawingBuffer: true,
  stencil: true,
})

const scene = new Scene(engine)
scene.clearColor = new Color4(0.05, 0.07, 0.12, 1.0)
scene.ambientColor = new Color3(0.55, 0.55, 0.6)

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

const camera = new ArcRotateCamera(
  'camera',
  Math.PI / 4,
  Math.PI / 3,
  28,
  new Vector3(0, 0, 0),
  scene,
)
camera.lowerRadiusLimit = 5
camera.upperRadiusLimit = 200
camera.attachControl(canvas, true)
camera.wheelDeltaPercentage = 0.05

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------

const light = new HemisphericLight('light', new Vector3(0.2, 1, 0.3), scene)
light.intensity = 1.0
light.diffuse = new Color3(0.95, 0.95, 0.95)
light.groundColor = new Color3(0.45, 0.45, 0.5)
light.specular = new Color3(0.1, 0.1, 0.1)

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type ViewMode = 'tiles' | 'resources' | 'height' | 'all'
let currentView: ViewMode = 'tiles'
let heightScale = 1.0
let currentMap: Map | null = null
let terrainMeshes: Mesh[] = []
let currentMapSize = 32
let currentSeed = 42

// ---------------------------------------------------------------------------
// Terrain type colors for visualization
// ---------------------------------------------------------------------------

const TERRAIN_COLORS: Record<number, [number, number, number]> = {
  0: [0.565, 0.933, 0.565], // Clear - light green
  1: [0.824, 0.706, 0.549], // Rough - tan
  2: [0.439, 0.502, 0.565], // Road - slate gray
  3: [0.255, 0.412, 0.882], // Water - royal blue
  4: [0.502, 0.502, 0.502], // Rock - gray
  5: [0.627, 0.322, 0.176], // Wall - sienna
  6: [0.0,   0.694, 0.498], // Tiberium - spring green
}

const TERRAIN_NAMES: Record<number, string> = {
  0: 'Clear', 1: 'Rough', 2: 'Road', 3: 'Water',
  4: 'Rock', 5: 'Wall', 6: 'Tiberium',
}

// ---------------------------------------------------------------------------
// Build cell meshes
// ---------------------------------------------------------------------------

function buildMapMesh(map: Map, viewMode: ViewMode, hScale: number): void {
  for (const m of terrainMeshes) m.dispose()
  terrainMeshes = []

  const size = currentMapSize
  const maxH = Math.max(map.grid.maximumTerrainHeight, 1)
  const cellWorldSize = 0.5
  const gap = 0.02

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      const uv = new MPos(x, y)
      const tile = map.tiles.getMPos(uv)
      const resource = map.resources.getMPos(uv)
      const h = map.height.getMPos(uv)
      const ramp = map.ramp.getMPos(uv)

      const wx = (x - size / 2 + 0.5) * (cellWorldSize + gap)
      const wz = (y - size / 2 + 0.5) * (cellWorldSize + gap)
      const wy = (h / maxH) * hScale

      let color: [number, number, number]
      switch (viewMode) {
        case 'tiles': {
          const tc = TERRAIN_COLORS[tile.type] ?? [0.3, 0.3, 0.3]
          color = [tc[0], tc[1], tc[2]]
          break
        }
        case 'resources':
          if (resource.type > 0) {
            const b = resource.index / 10
            color = [0.0, 0.694 + b * 0.3, 0.498]
          } else {
            color = [0.15, 0.15, 0.15]
          }
          break
        case 'height':
          if (h === 0) {
            color = [0.15, 0.3, 0.15]
          } else if (h === 1) {
            color = [0.6, 0.5, 0.2]
          } else {
            color = [0.7, 0.65, 0.6]
          }
          break
        case 'all':
        default: {
          const tc = TERRAIN_COLORS[tile.type] ?? [0.3, 0.3, 0.3]
          const hFrac = h / maxH
          color = [
            tc[0] * (1 - hFrac * 0.3),
            tc[1] * (1 - hFrac * 0.3),
            tc[2] * (1 - hFrac * 0.2),
          ]
          break
        }
      }

      const plane = MeshBuilder.CreatePlane(`cell-${x}-${y}`, {
        width: cellWorldSize,
        height: cellWorldSize,
      }, scene)
      plane.position = new Vector3(wx, wy, wz)
      plane.rotation.x = -Math.PI / 2

      const c3 = new Color3(color[0], color[1], color[2])
      const mat = new StandardMaterial(`mat-${x}-${y}`, scene)
      // Disable all lighting so the rendered color matches TERRAIN_COLORS exactly.
      // This is an acceptance-test page: color accuracy matters more than realism.
      mat.disableLighting = true
      mat.emissiveColor = c3
      mat.backFaceCulling = false
      plane.material = mat

      plane.metadata = { x, y, tile, resource, h, ramp }

      terrainMeshes.push(plane)
    }
  }

  camera.target = new Vector3(0, heightScale * 0.5, 0)
}

// ---------------------------------------------------------------------------
// Rebuild scene
// ---------------------------------------------------------------------------

function rebuildScene(): void {
  const map = generateMap(currentMapSize, currentSeed)
  currentMap = map
  buildMapMesh(map, currentView, heightScale)
  updateInfoBar()
  updateLegend()
}

// ---------------------------------------------------------------------------
// Update info bar
// ---------------------------------------------------------------------------

function updateInfoBar(): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.slice(0, 80)
  document.getElementById('info-viewport')!.textContent = `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}x`
  const glVer = (engine as any).webGLVersion ?? '2'
  document.getElementById('info-engine')!.textContent = `WebGL ${glVer}.0`
  document.getElementById('info-grid')!.textContent = `${currentMapSize}x${currentMapSize} Rectangular`
  document.getElementById('info-time')!.textContent = new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Update legend
// ---------------------------------------------------------------------------

function updateLegend(): void {
  const legendEl = document.getElementById('legend-area')!
  if (currentView === 'tiles' || currentView === 'all') {
    legendEl.innerHTML = Object.entries(TERRAIN_NAMES).map(([k, name]) => {
      const c = TERRAIN_COLORS[parseInt(k)] ?? [0.3, 0.3, 0.3]
      const hex = `#${Math.round(c[0]*255).toString(16).padStart(2,'0')}${Math.round(c[1]*255).toString(16).padStart(2,'0')}${Math.round(c[2]*255).toString(16).padStart(2,'0')}`.toUpperCase()
      return `<div class="legend-item"><div class="legend-swatch" style="background:${hex};"></div> ${name}</div>`
    }).join('')
  } else if (currentView === 'height') {
    legendEl.innerHTML = `
      <div class="legend-item"><div class="legend-swatch" style="background:#267426;"></div> H=0 (Low)</div>
      <div class="legend-item"><div class="legend-swatch" style="background:#998033;"></div> H=1 (Mid)</div>
      <div class="legend-item"><div class="legend-swatch" style="background:#B3A699;"></div> H=2 (High)</div>
    `
  } else {
    legendEl.innerHTML = `
      <div class="legend-item"><div class="legend-swatch" style="background:#262626;"></div> No Resource</div>
      <div class="legend-item"><div class="legend-swatch" style="background:#00E07F;"></div> Tiberium</div>
    `
  }
}

// ---------------------------------------------------------------------------
// View mode buttons
// ---------------------------------------------------------------------------

function setViewMode(mode: ViewMode): void {
  currentView = mode
  document.getElementById('view-tiles')!.classList.toggle('active', mode === 'tiles')
  document.getElementById('view-resources')!.classList.toggle('active', mode === 'resources')
  document.getElementById('view-height')!.classList.toggle('active', mode === 'height')
  document.getElementById('view-all')!.classList.toggle('active', mode === 'all')

  if (currentMap) {
    buildMapMesh(currentMap, mode, heightScale)
    updateLegend()
  }
}

document.getElementById('view-tiles')!.addEventListener('click', () => setViewMode('tiles'))
document.getElementById('view-resources')!.addEventListener('click', () => setViewMode('resources'))
document.getElementById('view-height')!.addEventListener('click', () => setViewMode('height'))
document.getElementById('view-all')!.addEventListener('click', () => setViewMode('all'))

// ---------------------------------------------------------------------------
// Height scale slider
// ---------------------------------------------------------------------------

document.getElementById('height-scale-slider')!.addEventListener('input', (e) => {
  heightScale = parseFloat((e.target as HTMLInputElement).value)
  document.getElementById('hs-val')!.textContent = `${heightScale.toFixed(1)}x`
  if (currentMap) {
    buildMapMesh(currentMap, currentView, heightScale)
  }
})

// ---------------------------------------------------------------------------
// Click to select cell
// ---------------------------------------------------------------------------

canvas.addEventListener('click', (evt) => {
  const pick = scene.pick(evt.offsetX, evt.offsetY)
  if (!pick || !pick.pickedMesh || !pick.pickedMesh.metadata) return
  const meta = pick.pickedMesh.metadata as Record<string, any> | null
  if (!meta || !('x' in meta) || !('y' in meta)) return
  const { x, y, tile, resource, h, ramp } = meta

  document.getElementById('ci-cpos')!.textContent = `(${x}, ${y})`
  document.getElementById('ci-mpos')!.textContent = `(${x}, ${y})`
  document.getElementById('ci-wpos')!.textContent = `(${1024 * x + 512}, ${1024 * y + 512}, ${h})`
  document.getElementById('ci-tile')!.textContent = `type=${tile.type}, idx=${tile.index} (${TERRAIN_NAMES[tile.type] ?? '?'})`
  document.getElementById('ci-res')!.textContent = `type=${resource.type}, density=${resource.index}`
  document.getElementById('ci-height')!.textContent = `${h}`
  document.getElementById('ci-ramp')!.textContent = `${ramp}`
})

// ---------------------------------------------------------------------------
// Regenerate
// ---------------------------------------------------------------------------

document.getElementById('regenerate')!.addEventListener('click', () => {
  currentMapSize = parseInt((document.getElementById('map-size-select') as HTMLSelectElement).value, 10)
  currentSeed = parseInt((document.getElementById('seed-input') as HTMLInputElement).value, 10) || 42
  rebuildScene()
})

// ---------------------------------------------------------------------------
// Reset camera
// ---------------------------------------------------------------------------

document.getElementById('reset-camera')!.addEventListener('click', () => {
  camera.alpha = Math.PI / 4
  camera.beta = Math.PI / 3
  camera.radius = 28
  camera.target = new Vector3(0, heightScale * 0.5, 0)
})

// ---------------------------------------------------------------------------
// RAF
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

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

engine.resize()
rebuildScene()
