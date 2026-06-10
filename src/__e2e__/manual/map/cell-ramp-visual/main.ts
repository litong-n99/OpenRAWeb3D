/**
 * CellRamp Visual Acceptance Test — 21 slope shape 3D visualization
 *
 * Renders all 21 CellRamp shapes as colored 3D meshes so a human can verify:
 *  - Corner heights (Low/Half/Full) via vertex Y-values
 *  - Triangle polygon splits (Flat/X/Y) via mesh edge visibility
 *  - centerHeightOffset computed values
 *  - Grid type difference (square vs diamond)
 *
 * OpenRA 对照: CellRamp.cs + MapGrid.createRamps()
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
  VertexData,
} from '@babylonjs/core'
import { MapGrid } from '../../../../OpenRA.Game/Map/MapGrid'
import { MapGridType } from '../../../../OpenRA.Game/Map/MapGridType'
import { WRot } from '../../../../OpenRA.Game/WRot'
import { WVec } from '../../../../OpenRA.Game/WVec'

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
scene.clearColor = new Color4(0.05, 0.07, 0.12, 1.0)

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

const camera = new ArcRotateCamera(
  'camera',
  Math.PI / 4,
  Math.PI / 3,
  3500,
  new Vector3(0, 200, 0),
  scene,
)
camera.lowerRadiusLimit = 500
camera.upperRadiusLimit = 8000
camera.target = new Vector3(0, 150, 0)
camera.attachControl(canvas, true)
camera.wheelDeltaPercentage = 0.05

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------

scene.ambientColor = new Color3(0.3, 0.3, 0.35)

const light = new HemisphericLight('light', new Vector3(0.2, 1, 0.3), scene)
light.intensity = 0.8
light.diffuse = new Color3(0.9, 0.9, 0.9)
light.specular = new Color3(0.1, 0.1, 0.1)

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentGridType: MapGridType = MapGridType.Rectangular
const rampMeshes: Mesh[] = []
const rampParentNodes: Mesh[] = []
let selectedRampIndex = -1

// ---------------------------------------------------------------------------
// Height → color mapping
// ---------------------------------------------------------------------------

function heightToColor(height: number, maxHeight: number): Color3 {
  if (maxHeight === 0) return new Color3(0.2, 0.4, 0.9) // blue for flat
  const t = Math.min(1, Math.max(0, height / maxHeight))
  // Blue (0,0) → Yellow (0.5) → Red (1.0)
  if (t < 0.5) {
    const s = t * 2
    return new Color3(s * 0.95, s * 0.6 + (1 - s) * 0.4, (1 - s) * 0.9)
  } else {
    const s = (t - 0.5) * 2
    return new Color3(0.95, (1 - s) * 0.6, 0)
  }
}

// ---------------------------------------------------------------------------
// Convert WVec to Babylon Vector3 (OpenRA X,Y,Z → Bab X, Z_up, Y_ground)
// ---------------------------------------------------------------------------

const SCALE = 1.0

function wvecToBjs(w: WVec): Vector3 {
  return new Vector3(w.X * SCALE, w.Z * SCALE, w.Y * SCALE)
}

// ---------------------------------------------------------------------------
// Build ramp scene
// ---------------------------------------------------------------------------

function buildRamps(gridType: MapGridType): void {
  // Clean up old meshes
  for (const m of rampMeshes) m.dispose()
  for (const n of rampParentNodes) n.dispose()
  rampMeshes.length = 0
  rampParentNodes.length = 0
  selectedRampIndex = -1

  const grid = new MapGrid({ type: gridType })
  const ramps = grid.ramps
  const tileScale = grid.tileScale // 1024 or 1448
  const maxPossibleHeight = tileScale * 2 // Full = 2 * scale

  // Layout: 7 columns x 3 rows = 21
  const cols = 7
  const cellSize = tileScale + 400 // spacing between cells
  const rows = Math.ceil(ramps.length / cols)

  for (let i = 0; i < ramps.length; i++) {
    const ramp = ramps[i]!
    const col = i % cols
    const row = Math.floor(i / cols)

    // Compute center position for this ramp in the grid
    const offsetX = (col - (cols - 1) / 2) * cellSize
    const offsetZ = (row - (rows - 1) / 2) * cellSize

    // Parent transform node for positioning
    const parentNode = new Mesh(`ramp-parent-${i}`, scene)
    parentNode.position = new Vector3(offsetX, 0, offsetZ)
    rampParentNodes.push(parentNode)

    // Build mesh from polygon triangles/quads
    const polygons = ramp.polygons

    // Combine all triangles into a single custom mesh
    // Flat split: 1 quad (4 vertices) → 2 triangles (0,1,2 + 0,2,3)
    // X/Y split: 2 triangles (3 vertices each)
    const positions: number[] = []
    const colors: number[] = []
    const indices: number[] = []

    for (const poly of polygons) {
      const baseIdx = positions.length / 3

      // Push all vertices for this polygon
      for (let v = 0; v < poly.length; v++) {
        const wv = poly[v]!
        const bjs = wvecToBjs(wv)
        positions.push(bjs.x, bjs.y, bjs.z)

        const c = heightToColor(wv.Z, maxPossibleHeight)
        colors.push(c.r, c.g, c.b, 1.0)
      }

      if (poly.length === 4) {
        // Quad: triangulate as two triangles (0,1,2) and (0,2,3)
        indices.push(baseIdx, baseIdx + 1, baseIdx + 2)
        indices.push(baseIdx, baseIdx + 2, baseIdx + 3)
      } else {
        // Triangle
        indices.push(baseIdx, baseIdx + 1, baseIdx + 2)
      }
    }

    const rampMesh = new Mesh(`ramp-${i}`, scene)
    rampMesh.parent = parentNode

    const vertexData = new VertexData()
    vertexData.positions = positions
    vertexData.indices = indices
    vertexData.colors = colors
    vertexData.applyToMesh(rampMesh, true)

    // Edges rendering: create thin tubes along polygon edges
    const drawnEdges = new Set<string>()
    for (const poly of polygons) {
      for (let v = 0; v < poly.length; v++) {
        const a = poly[v]!
        const b = poly[(v + 1) % poly.length]!
        const edgeKey = `${Math.min(a.X, b.X)},${Math.min(a.Y, b.Y)},${Math.min(a.Z, b.Z)}|${Math.max(a.X, b.X)},${Math.max(a.Y, b.Y)},${Math.max(a.Z, b.Z)}`
        if (drawnEdges.has(edgeKey)) continue
        drawnEdges.add(edgeKey)

        const ba = wvecToBjs(a)
        const bb = wvecToBjs(b)

        const edgeLine = MeshBuilder.CreateTube(`edge-${i}-${drawnEdges.size}`, {
          path: [ba, bb],
          radius: 4,
        }, scene)
        edgeLine.parent = parentNode

        // Gray edge material
        const edgeMat = new StandardMaterial(`edgeMat-${i}-${drawnEdges.size}`, scene)
        edgeMat.diffuseColor = new Color3(0.5, 0.5, 0.5)
        edgeMat.emissiveColor = new Color3(0.2, 0.2, 0.2)
        edgeMat.alpha = 0.7
        edgeLine.material = edgeMat

        rampMeshes.push(edgeLine)
      }
    }

    // Corner spheres
    const cornerNames = ['TL', 'TR', 'BR', 'BL']
    const corners = ramp.corners

    for (let c = 0; c < 4; c++) {
      const wv = corners[c]!
      const bjs = wvecToBjs(wv)
      const radius = wv.Z > maxPossibleHeight * 0.25 ? 35 : 18
      const sphere = MeshBuilder.CreateSphere(`corner-${i}-${cornerNames[c]}`, {
        diameter: radius * 2,
      }, scene)
      sphere.parent = parentNode
      sphere.position = bjs

      const sphereMat = new StandardMaterial(`sphereMat-${i}-${c}`, scene)
      sphereMat.diffuseColor = heightToColor(wv.Z, maxPossibleHeight)
      sphereMat.emissiveColor = sphereMat.diffuseColor.scale(0.3)
      sphere.material = sphereMat

      rampMeshes.push(sphere)
    }

    // Material for the ramp mesh
    const mat = new StandardMaterial(`rampMat-${i}`, scene)
    mat.diffuseColor = new Color3(0.7, 0.7, 0.7)
    mat.emissiveColor = new Color3(0.1, 0.1, 0.1)
    mat.alpha = 0.85
    mat.backFaceCulling = false
    rampMesh.material = mat

    rampMeshes.push(rampMesh)
  }

  currentGridType = gridType
  updateInfoBar()
}

// ---------------------------------------------------------------------------
// Update detail panel for selected ramp
// ---------------------------------------------------------------------------

function updateRampDetail(index: number): void {
  const grid = new MapGrid({ type: currentGridType })
  const ramp = grid.ramps[index]

  document.getElementById('det-index')!.textContent = `#${index} / 21`
  document.getElementById('det-center')!.textContent = `${ramp.centerHeightOffset}`
  document.getElementById('det-tl')!.textContent = `${ramp.corners[0].Z}`
  document.getElementById('det-tr')!.textContent = `${ramp.corners[1].Z}`
  document.getElementById('det-br')!.textContent = `${ramp.corners[2].Z}`
  document.getElementById('det-bl')!.textContent = `${ramp.corners[3].Z}`

  // Determine split type
  const polys = ramp.polygons
  let splitName = 'Flat (1 quad, 4 vertices)'
  if (polys.length === 2) {
    const p0 = polys[0]!
    // X split: 0-1-3 + 1-2-3
    // Y split: 0-1-2 + 0-2-3
    if (p0.length === 3 && ramp.corners[0] === p0[0] && ramp.corners[1] === p0[1] && ramp.corners[3] === p0[2]) {
      splitName = 'X (diagonal TL→BR)'
    } else if (p0.length === 3 && ramp.corners[0] === p0[0] && ramp.corners[1] === p0[1] && ramp.corners[2] === p0[2]) {
      splitName = 'Y (diagonal TR→BL)'
    } else {
      splitName = `Split (${polys.length} tri)`
    }
  }
  document.getElementById('det-split')!.textContent = splitName

  document.getElementById('det-has-orient')!.textContent = ramp.orientation.equals(WRot.None) ? 'None (WRot.None)' : 'Has orientation'
}

// ---------------------------------------------------------------------------
// Update info bar
// ---------------------------------------------------------------------------

function updateInfoBar(): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.slice(0, 80)
  document.getElementById('info-viewport')!.textContent = `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}x`
  const glVer = (engine as any).webGLVersion ?? '2'
  document.getElementById('info-engine')!.textContent = `WebGL ${glVer}.0`
  document.getElementById('info-grid-type')!.textContent =
    currentGridType === MapGridType.Rectangular ? 'Rectangular (1024)' : 'RectangularIsometric (1448)'
  document.getElementById('info-time')!.textContent = new Date().toISOString()
}

// ---------------------------------------------------------------------------
// RAF loop
// ---------------------------------------------------------------------------

engine.runRenderLoop(() => {
  scene.render()
  document.getElementById('info-fps')!.textContent = `${engine.getFps().toFixed(1)}`
})

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

// Grid type switch
document.getElementById('grid-type-select')!.addEventListener('change', (e) => {
  const val = (e.target as HTMLSelectElement).value
  const newType = val === 'isometric' ? MapGridType.RectangularIsometric : MapGridType.Rectangular
  buildRamps(newType)
  updateRampDetail(0)
})

// Reset camera
document.getElementById('reset-camera')!.addEventListener('click', () => {
  camera.alpha = Math.PI / 4
  camera.beta = Math.PI / 3
  camera.radius = 3500
  camera.target = new Vector3(0, 150, 0)
})

// Click detection on ramp meshes
canvas.addEventListener('click', (evt) => {
  const pick = scene.pick(evt.offsetX, evt.offsetY)
  if (!pick || !pick.pickedMesh) return
  const meshName = pick.pickedMesh.name
  const match = meshName.match(/^ramp-(\d+)$/) || meshName.match(/^corner-(\d+)-/)
  if (!match) return
  const idx = parseInt(match[1]!, 10)
  if (idx >= 0 && idx < 21) {
    selectedRampIndex = idx
    updateRampDetail(idx)
  }
})

// Resize
window.addEventListener('resize', () => {
  engine.resize()
  updateInfoBar()
})

// Keyboard: arrow keys to cycle through ramps
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    selectedRampIndex = Math.min(20, (selectedRampIndex + 1) % 21)
    if (selectedRampIndex < 0) selectedRampIndex = 0
    updateRampDetail(selectedRampIndex)
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    selectedRampIndex = Math.max(0, selectedRampIndex <= 0 ? 20 : selectedRampIndex - 1)
    updateRampDetail(selectedRampIndex)
  }
})

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

buildRamps(currentGridType)
updateRampDetail(0)
updateInfoBar()
