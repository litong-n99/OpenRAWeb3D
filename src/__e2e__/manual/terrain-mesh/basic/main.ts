/**
 * terrain-mesh/basic/main.ts — TerrainMeshBuilder visual acceptance test
 *
 * Verifies:
 * 1. Flat rectangular terrain renders as a continuous grid without cracks
 * 2. Ramp cells produce visible sloped geometry
 * 3. Isometric grid produces diamond-shaped terrain
 * 4. Camera can inspect from multiple angles
 */

import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  Vector3,
  Color4,
  Mesh,
  StandardMaterial,
  Color3,
} from '@babylonjs/core'
import { Map as GameMap } from '../../../../OpenRA.Game/Map/Map'
import { MapGrid } from '../../../../OpenRA.Game/Map/MapGrid'
import { MapGridType } from '../../../../OpenRA.Game/Map/MapGridType'
import { CPos } from '../../../../OpenRA.Game/CPos'
import { TerrainMeshBuilder } from '../../../../OpenRA.Game/Map/TerrainMeshBuilder'
import type { TerrainTileInfo, TerrainTypeInfo } from '../../../../OpenRA.Game/Map/TerrainInfo'
import type { TerrainTile } from '../../../../OpenRA.Game/Map/TileReference'
import type { ITerrainInfo } from '../../../../OpenRA.Game/Map/Map'

// ---------------------------------------------------------------------------
// Test Helpers — minimal terrain info
// ---------------------------------------------------------------------------

function makeTileInfo(overrides: Partial<TerrainTileInfo> = {}): TerrainTileInfo {
  return {
    terrainType: 0,
    height: 0,
    rampType: 0,
    minColor: 0xffffffff,
    maxColor: 0xffffffff,
    riser: { values: new Uint8Array(8), getConnection: () => 0 },
    getColor: () => 0xffffffff,
    ...overrides,
  } as unknown as TerrainTileInfo
}

function makeTerrainType(overrides: Partial<TerrainTypeInfo> = {}): TerrainTypeInfo {
  return {
    type: 'Clear',
    targetTypes: new Set(),
    acceptsSmudgeType: new Set(),
    color: 0xff00ff00,
    restrictPlayerColor: false,
    ...overrides,
  } as unknown as TerrainTypeInfo
}

function makeTerrainInfo(): ITerrainInfo {
  const tileMap = new globalThis.Map<number, TerrainTileInfo>()
  const defaultTile: TerrainTile = { type: 0, index: 0 }
  for (let t = 0; t <= 10; t++) {
    tileMap.set(t, makeTileInfo({ terrainType: t % 4, height: 0, rampType: t % 21 }))
  }
  return {
    id: 'test',
    terrainTypes: [makeTerrainType(), makeTerrainType({ type: 'Rough' })],
    defaultTerrainTile: defaultTile,
    getTerrainInfo: (tile: TerrainTile) => tileMap.get(tile.type) ?? makeTileInfo(),
    tryGetTerrainInfo: (tile: TerrainTile) => tileMap.get(tile.type) ?? null,
    getTerrainIndex: (tile: TerrainTile) => tileMap.get(tile.type)?.terrainType ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Scene Setup
// ---------------------------------------------------------------------------

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
const engine = new Engine(canvas, true)
const scene = new Scene(engine)
scene.clearColor = new Color4(0.12, 0.14, 0.18, 1)

// Camera
const camera = new ArcRotateCamera('camera', -Math.PI / 4, Math.PI / 3, 15, new Vector3(4, 0, 4), scene)
camera.attachControl(canvas, true)
camera.lowerRadiusLimit = 2
camera.upperRadiusLimit = 50

// Lights
new HemisphericLight('hemi', new Vector3(0.5, 1, 0.5), scene)

// ---------------------------------------------------------------------------
// Terrain Generation Functions
// ---------------------------------------------------------------------------

function createFlatTerrain(): Mesh {
  const grid = new MapGrid({ type: MapGridType.Rectangular, maximumTerrainHeight: 0 })
  const map = GameMap.createBlank(grid, { width: 8, height: 8 }, makeTerrainInfo())
  return TerrainMeshBuilder.build(map, scene).mesh
}

function createRampTerrain(): Mesh {
  const grid = new MapGrid({ type: MapGridType.Rectangular, maximumTerrainHeight: 4 })
  const map = GameMap.createBlank(grid, { width: 8, height: 8 }, makeTerrainInfo())

  // Create a diagonal ramp from SW to NE
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const h = Math.min(3, (x + y) / 3)
      map.height.set(new CPos(x, y), Math.floor(h))
      // Ramp type 5 = BR corner half
      if (h > 0 && h < 3) {
        map.ramp.set(new CPos(x, y), 5)
      }
    }
  }

  return TerrainMeshBuilder.build(map, scene).mesh
}

function createIsometricTerrain(): Mesh {
  const grid = new MapGrid({ type: MapGridType.RectangularIsometric, maximumTerrainHeight: 0 })
  const map = GameMap.createBlank(grid, { width: 8, height: 8 }, makeTerrainInfo())
  return TerrainMeshBuilder.build(map, scene).mesh
}

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------

function applyWireframeMaterial(mesh: Mesh): void {
  const mat = new StandardMaterial('wireframe', scene)
  mat.wireframe = true
  mat.diffuseColor = new Color3(0.4, 0.8, 0.4)
  mat.specularColor = new Color3(0.1, 0.1, 0.1)
  mesh.material = mat
}

function applySolidMaterial(mesh: Mesh): void {
  const mat = new StandardMaterial('solid', scene)
  mat.diffuseColor = new Color3(0.5, 0.6, 0.4)
  mat.specularColor = new Color3(0.1, 0.1, 0.1)
  mesh.material = mat
}

// ---------------------------------------------------------------------------
// State Management
// ---------------------------------------------------------------------------

let currentMesh: Mesh | null = null
let wireframeMode = false

function showTerrain(mode: 'flat' | 'ramp' | 'iso'): void {
  if (currentMesh) {
    currentMesh.dispose()
    currentMesh = null
  }

  switch (mode) {
    case 'flat':
      currentMesh = createFlatTerrain()
      camera.target = new Vector3(4, 0, 4)
      break
    case 'ramp':
      currentMesh = createRampTerrain()
      camera.target = new Vector3(4, 0.5, 4)
      break
    case 'iso':
      currentMesh = createIsometricTerrain()
      camera.target = new Vector3(4, 0, 4)
      break
  }

  if (wireframeMode) {
    applyWireframeMaterial(currentMesh)
  } else {
    applySolidMaterial(currentMesh)
  }
}

// ---------------------------------------------------------------------------
// Keyboard Controls
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  switch (e.key) {
    case '1':
      showTerrain('flat')
      break
    case '2':
      showTerrain('ramp')
      break
    case '3':
      showTerrain('iso')
      break
    case 'w':
    case 'W':
      wireframeMode = !wireframeMode
      if (currentMesh) {
        if (wireframeMode) applyWireframeMaterial(currentMesh)
        else applySolidMaterial(currentMesh)
      }
      break
  }
})

// ---------------------------------------------------------------------------
// Stats Panel Update
// ---------------------------------------------------------------------------

const statsEl = document.getElementById('stats')!

function updateStats(): void {
  if (!currentMesh) {
    statsEl.textContent = 'No mesh'
    return
  }
  const verts = currentMesh.getTotalVertices()
  const tris = (currentMesh.getIndices()?.length ?? 0) / 3
  const mode = wireframeMode ? 'wireframe' : 'solid'
  statsEl.textContent = `Mode: ${mode} | Vertices: ${verts} | Triangles: ${tris} | FPS: ${Math.round(engine.getFps())}`
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

showTerrain('flat')

engine.runRenderLoop(() => {
  scene.render()
  updateStats()
})

window.addEventListener('resize', () => {
  engine.resize()
})

// Expose for test harness access
;(window as any).__testHarness = {
  scene,
  camera,
  engine,
  getCurrentMesh: () => currentMesh,
  getVertexCount: () => currentMesh?.getTotalVertices() ?? 0,
  getTriangleCount: () => (currentMesh?.getIndices()?.length ?? 0) / 3,
  showTerrain,
  toggleWireframe: () => {
    wireframeMode = !wireframeMode
    if (currentMesh) {
      if (wireframeMode) applyWireframeMaterial(currentMesh)
      else applySolidMaterial(currentMesh)
    }
  },
}
