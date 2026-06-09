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
  RawTexture,
} from '@babylonjs/core'
import { MapGrid } from '../../../../OpenRA.Game/Map/MapGrid'
import { MapGridType } from '../../../../OpenRA.Game/Map/MapGridType'
import { WRot } from '../../../../OpenRA.Game/WRot'
import { WVec } from '../../../../OpenRA.Game/WVec'

// Grid layout constants — 7 columns × 3 rows = 21 ramps
const COLS = 7
const ROWS = 3

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
// Shared 1x1 white emissive texture for disableLighting materials.
//
// When disableLighting=true on StandardMaterial, the fragment shader outputs
//   emissiveColor * sample(emissiveTexture)
// without any lighting calculation.  A white 1x1 texture acts as the identity
// multiplier, letting emissiveColor pass through unmodified.
//
// This is the proven pattern from terrain-sprite-layer and world-renderer
// acceptance test pages (see commit e8abc79).
// ---------------------------------------------------------------------------

const WHITE_TEX = new RawTexture(
  new Uint8Array([255, 255, 255, 255]),
  1, 1,
  Engine.TEXTUREFORMAT_RGBA,
  scene,
  false,
)

// ---------------------------------------------------------------------------
// Camera
//
// Grid sizing (used by both camera and buildRamps):
//   Rectangular:  cell spacing = tileScale(1024) + gap(400) = 1424
//   Isometric:    cell spacing = tileScale(1448) + gap(400) = 1848
//   Grid width  ≈ COLS × spacing ≈ 10K–13K world units
//   Camera needs radius ≈ width / 1.2 to frame the full grid at 60° beta.
// ---------------------------------------------------------------------------

const BASE_CELL_SPACING = 1024 + 400 // Rectangular default; recalculated in buildRamps

const camera = new ArcRotateCamera(
  'camera',
  Math.PI / 4,
  Math.PI / 3,
  BASE_CELL_SPACING * COLS * 1.2,
  new Vector3(0, 0, 0),
  scene,
)
camera.lowerRadiusLimit = BASE_CELL_SPACING / 2
camera.upperRadiusLimit = BASE_CELL_SPACING * COLS * 3
camera.wheelPrecision = 40
camera.panningSensibility = 200
camera.attachControl(canvas, true)
camera.target = new Vector3(0, 0, 0)

// ---------------------------------------------------------------------------
// Lighting
//
// Two hemispheric lights from opposite directions + high ambient so that
// sloped surfaces are visible from any camera angle (fixes Bug 3).
// ---------------------------------------------------------------------------

// Main light: above and slightly to the right
const light1 = new HemisphericLight('light1', new Vector3(0.2, 1, 0.3), scene)
light1.intensity = 0.9
light1.diffuse = new Color3(0.95, 0.95, 0.95)
light1.specular = new Color3(0.05, 0.05, 0.05)
light1.groundColor = new Color3(0.2, 0.2, 0.25)

// Fill light: from below to illuminate undersides of slopes
const light2 = new HemisphericLight('light2', new Vector3(-0.2, -1, -0.3), scene)
light2.intensity = 0.4
light2.diffuse = new Color3(0.6, 0.6, 0.7)
light2.specular = new Color3(0, 0, 0)
light2.groundColor = new Color3(0.15, 0.15, 0.18)

// ---------------------------------------------------------------------------
// Ambient color — global base illumination applied to all materials.
// Babylon.js default is (0, 0, 0). Without ambient, the only light a
// surface receives is HemisphericLight interpolation between diffuse and
// groundColor. Surfaces whose normals interpolate to a dark mix (e.g. a
// slope facing sideways relative to both lights) get very little light.
// Setting ambient provides a guaranteed brightness floor.
// ---------------------------------------------------------------------------

scene.ambientColor = new Color3(0.25, 0.25, 0.28)

// ---------------------------------------------------------------------------
// Lighting diagnostics
// ---------------------------------------------------------------------------

interface DiagEntry {
  time: number
  ambient: string
  camAlphaDeg: number
  camBetaDeg: number
  lightCount: number
  shadowGenCount: number
  sampleNormal: string
  light1State: string
  light2State: string
}

/**
 * Dump complete lighting state to console.  Called on camera rotation
 * (throttled) and on demand via the 'L' key.  Also populates the
 * diagnostic panel element #diag-output in the side bar.
 */
function dumpLightingState(reason: string): void {
  // ---- gather data ----
  const lights = scene.lights ?? []
  const shadowGens = (scene as any).shadowGenerators ?? []
  const hasShadowGens = Array.isArray(shadowGens) ? shadowGens.length : 0

  // sample the first ramp mesh (ramp-0) to read one computed normal
  let sampleNormal = 'N/A'
  const sampleMesh = scene.getMeshByName('ramp-0')
  if (sampleMesh) {
    const data = sampleMesh.getVerticesData('normal')
    if (data && data.length >= 3) {
      sampleNormal = `(${data[0]!.toFixed(3)}, ${data[1]!.toFixed(3)}, ${data[2]!.toFixed(3)})`
    }
  }

  const camDir = camera.getDirection(new Vector3(0, 0, 1))
  const camPos = camera.position

  const fmtColor = (c: Color3): string =>
    `(${c.r.toFixed(2)}, ${c.g.toFixed(2)}, ${c.b.toFixed(2)})`

  const entry: DiagEntry = {
    time: performance.now(),
    ambient: fmtColor(scene.ambientColor),
    camAlphaDeg: Math.round((camera.alpha * 180) / Math.PI) % 360,
    camBetaDeg: Math.round((camera.beta * 180) / Math.PI),
    lightCount: lights.length,
    shadowGenCount: hasShadowGens,
    sampleNormal,
    light1State: `dir=${light1.direction.toString()} int=${light1.intensity} diff=${fmtColor(light1.diffuse)} spec=${fmtColor(light1.specular)} ground=${fmtColor(light1.groundColor)}`,
    light2State: `dir=${light2.direction.toString()} int=${light2.intensity} diff=${fmtColor(light2.diffuse)} spec=${fmtColor(light2.specular)} ground=${fmtColor(light2.groundColor)}`,
  }

  // ---- console log ----
  console.group(
    `[LIGHTING DIAG] ${reason} @ ${new Date().toISOString().slice(11, 19)}`,
  )
  console.log('scene.ambientColor       =', entry.ambient)
  console.log('scene.lights count       =', entry.lightCount)
  console.log('shadowGenerators count   =', entry.shadowGenCount)
  console.log('camera alpha (deg)       =', entry.camAlphaDeg)
  console.log('camera beta  (deg)       =', entry.camBetaDeg)
  console.log('camera position          =', camPos.toString())
  console.log('camera look direction    =', camDir.toString())
  console.log('ramp-0 first normal      =', entry.sampleNormal)
  console.log('light1 (main)            =', entry.light1State)
  console.log('light2 (fill)            =', entry.light2State)
  console.log('--- per-light detail ---')
  for (const l of lights) {
    console.log(`  ${l.name}: enabled=${l.isEnabled()}, intensity=${l.intensity}, diffuse=${l.diffuse.toString()}`)
  }
  // log if any material has disableLighting
  let disableLightingCount = 0
  for (const m of scene.materials) {
    if (m && (m as any).disableLighting === true) disableLightingCount++
  }
  console.log('materials w/ disableLighting =', disableLightingCount)
  console.groupEnd()

  // ---- side-panel text update ----
  const diagEl = document.getElementById('diag-output')
  if (diagEl) {
    diagEl.textContent =
      `ambient=${entry.ambient} | cam α=${entry.camAlphaDeg}° β=${entry.camBetaDeg}°\n` +
      `lights=${entry.lightCount} shadows=${entry.shadowGenCount}\n` +
      `normal[0]=${entry.sampleNormal}\n` +
      `${entry.light1State}\n` +
      `${entry.light2State}`
  }
}

// Throttled camera-change logger: fires at most once per 500ms
let _lastDiagTime = 0
camera.onViewMatrixChangedObservable.add(() => {
  const now = performance.now()
  if (now - _lastDiagTime > 500) {
    _lastDiagTime = now
    dumpLightingState('camera moved')
  }
})

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
  const cols = COLS
  const cellSize = tileScale + 400 // spacing between cells
  const rows = ROWS

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

    // Build mesh from polygon triangles.
    // Each polygon is a triangle (3 WVec vertices).
    const polygons = ramp.polygons
    const positions: number[] = []
    const indices: number[] = []

    for (const tri of polygons) {
      const baseIdx = positions.length / 3

      for (let v = 0; v < 3; v++) {
        const wv = tri[v]!
        const bjs = wvecToBjs(wv)
        positions.push(bjs.x, bjs.y, bjs.z)
      }

      indices.push(baseIdx, baseIdx + 1, baseIdx + 2)
    }

    const rampMesh = new Mesh(`ramp-${i}`, scene)
    rampMesh.parent = parentNode

    const vertexData = new VertexData()
    vertexData.positions = positions
    vertexData.indices = indices

    // Compute per-vertex normals from the triangle geometry
    {
      const normals: number[] = []
      VertexData.ComputeNormals(positions, indices, normals)
      vertexData.normals = normals
    }

    vertexData.applyToMesh(rampMesh, true)

    // Material: disableLighting=true with per-ramp emissiveColor.
    //
    // StandardMaterial ignores vertex colors in the built-in shader, so
    // vertexData.colors is intentionally omitted.  Instead each ramp gets a
    // material whose emissiveColor encodes its height range — flat (blue)
    // through sloped (yellow) to steep (red).
    //
    // disableLighting=true REQUIRES an emissiveTexture in this Babylon.js
    // version.  WHITE_TEX (a 1x1 RGBA white pixel) acts as the identity
    // multiplier, so the final fragment color is just emissiveColor.
    {
      // Compute per-ramp color from the maximum corner height
      const maxCZ = Math.max(
        ramp.corners[0].Z, ramp.corners[1].Z,
        ramp.corners[2].Z, ramp.corners[3].Z,
      )
      const matColor = heightToColor(maxCZ, maxPossibleHeight)

      const mat = new StandardMaterial(`rampMat-${i}`, scene)
      mat.disableLighting = true
      mat.emissiveColor = matColor
      mat.emissiveTexture = WHITE_TEX
      mat.alpha = 0.88
      mat.backFaceCulling = false
      rampMesh.material = mat
    }
    // Uses CreateTube with a 2-point path — the tube naturally follows the
    // edge endpoints without manual orientation math.
    // (Fixes Bug 1: CreateCylinder + lookAt had Y/Z axis mismatch,
    //  producing misaligned "flying sticks" instead of aligned edges.)
    const drawnEdges = new Set<string>()
    for (const tri of polygons) {
      for (let v = 0; v < 3; v++) {
        const a = tri[v]!
        const b = tri[(v + 1) % 3]!
        const edgeKey = `${Math.min(a.X, b.X)},${Math.min(a.Y, b.Y)},${Math.min(a.Z, b.Z)}|${Math.max(a.X, b.X)},${Math.max(a.Y, b.Y)},${Math.max(a.Z, b.Z)}`
        if (drawnEdges.has(edgeKey)) continue
        drawnEdges.add(edgeKey)

        const ba = wvecToBjs(a)
        const bb = wvecToBjs(b)

        const tube = MeshBuilder.CreateTube(`edge-${i}-${drawnEdges.size}`, {
          path: [ba, bb],
          radius: 12,
          tessellation: 6,
        }, scene)
        tube.parent = parentNode

        const edgeMat = new StandardMaterial(`edgeMat-${i}-${drawnEdges.size}`, scene)
        edgeMat.disableLighting = true
        edgeMat.emissiveColor = new Color3(0.45, 0.45, 0.45)
        edgeMat.emissiveTexture = WHITE_TEX
        edgeMat.alpha = 0.55
        tube.material = edgeMat

        rampMeshes.push(tube)
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
      sphereMat.disableLighting = true
      sphereMat.emissiveColor = heightToColor(wv.Z, maxPossibleHeight)
      sphereMat.emissiveTexture = WHITE_TEX
      sphere.material = sphereMat

      rampMeshes.push(sphere)
    }

    rampMeshes.push(rampMesh)
  }

  currentGridType = gridType

  // Adjust camera limits for the current grid type
  const spacing = tileScale + 400
  camera.lowerRadiusLimit = spacing / 2
  camera.upperRadiusLimit = spacing * COLS * 3
  camera.radius = spacing * COLS * 1.2
  camera.target = new Vector3(0, 0, 0)

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
  let splitName = 'Flat (1 triangle)'
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
  const tileScale = currentGridType === MapGridType.RectangularIsometric ? 1448 : 1024
  const spacing = tileScale + 400
  camera.alpha = Math.PI / 4
  camera.beta = Math.PI / 3
  camera.radius = spacing * COLS * 1.2
  camera.target = new Vector3(0, 0, 0)
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

// Keyboard: arrow keys to cycle through ramps, L=dump lighting, I=inspector
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    selectedRampIndex = Math.min(20, (selectedRampIndex + 1) % 21)
    if (selectedRampIndex < 0) selectedRampIndex = 0
    updateRampDetail(selectedRampIndex)
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    selectedRampIndex = Math.max(0, selectedRampIndex <= 0 ? 20 : selectedRampIndex - 1)
    updateRampDetail(selectedRampIndex)
  } else if (e.key === 'l' || e.key === 'L') {
    dumpLightingState('manual (L key)')
  } else if (e.key === 'i' || e.key === 'I') {
    if (scene.debugLayer.isVisible()) {
      scene.debugLayer.hide()
    } else {
      scene.debugLayer.show({ overlay: true })
    }
  }
})

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

// Initial lighting diagnostic dump
dumpLightingState('startup')

buildRamps(currentGridType)
updateRampDetail(0)
updateInfoBar()
