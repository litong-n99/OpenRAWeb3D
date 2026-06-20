/**
 * main.ts — TeslaZap 3D Lightning Polish 人工验收测试
 *
 * 测试目标:
 *   1. TeslaZapMeshBuilder.createWithDefaults — 创建 emissive ShaderMaterial (bright cyan + dim blue)
 *   2. buildZaps() — 从 TeslaZapPath 生成 LinesMesh，验证 renderingGroupId=1, updatable=true
 *   3. updateJitter(tickCount) — 每帧顶点抖动 (deterministic via seed + tickCount)
 *   4. dispose() — 正确清理 GPU 资源（Mesh + ShaderMaterial）
 *
 * OpenRA 对照: TeslaZapRenderable (OpenRA.Mods.Cnc/Graphics/TeslaZapRenderable.cs)
 * Ch24 Phase B: Lightning Polish
 */

import { Engine } from '@babylonjs/core'
import { Scene } from '@babylonjs/core'
import { ArcRotateCamera } from '@babylonjs/core'
import { HemisphericLight } from '@babylonjs/core'
import { Vector3 } from '@babylonjs/core'
import { Color3, Color4 } from '@babylonjs/core'
import { MeshBuilder } from '@babylonjs/core'
import { StandardMaterial } from '@babylonjs/core'
import type { LinesMesh } from '@babylonjs/core'

import { TeslaZapMeshBuilder } from '../../../../OpenRA.Mods.Cnc/Graphics/TeslaZapRenderable.js'
import type { TeslaZapPath } from '../../../../OpenRA.Mods.Cnc/Graphics/TeslaZapRenderable.js'

// ---------------------------------------------------------------------------
// Canvas discovery / creation
// ---------------------------------------------------------------------------

let canvas = document.querySelector('#sandbox canvas') as HTMLCanvasElement | null
if (!canvas) {
  canvas = document.createElement('canvas')
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.display = 'block'
  canvas.style.outline = 'none'
  canvas.style.touchAction = 'none'
  document.getElementById('sandbox')!.appendChild(canvas)
}

// ---------------------------------------------------------------------------
// Babylon.js initialization
// ---------------------------------------------------------------------------

const engine = new Engine(canvas, true, {
  preserveDrawingBuffer: false,
  antialias: true,
})

const scene = new Scene(engine)
scene.clearColor = new Color4(0.02, 0.02, 0.06, 1.0)

// ---------------------------------------------------------------------------
// Camera + light
// ---------------------------------------------------------------------------

const camera = new ArcRotateCamera(
  'testCamera',
  -Math.PI / 4,   // alpha: orbit from front-right
  Math.PI / 4,    // beta: 45° elevation
  14,             // radius
  Vector3.Zero(), // target
  scene,
)
camera.lowerRadiusLimit = 4
camera.upperRadiusLimit = 40
camera.attachControl(canvas, true)

// Minimal ambient light — not needed for emissive lines, but keeps scene API happy
const light = new HemisphericLight('testLight', new Vector3(0, 1, 0), scene)
light.intensity = 0.3

// ---------------------------------------------------------------------------
// Reference ground plane (spatial context for the zap lines)
// ---------------------------------------------------------------------------

const groundMat = new StandardMaterial('groundMat', scene)
groundMat.diffuseColor = new Color3(0.08, 0.08, 0.10)
groundMat.specularColor = Color3.Black()
groundMat.backFaceCulling = false
groundMat.alpha = 0.5

const groundPlane = MeshBuilder.CreatePlane(
  'groundPlane',
  { width: 14, height: 8 },
  scene,
)
groundPlane.material = groundMat
groundPlane.position.set(0, 0, -0.02) // slightly behind the zap lines (which are at z=0)
groundPlane.renderingGroupId = 0

// ---------------------------------------------------------------------------
// Test zap path definitions
// ---------------------------------------------------------------------------

/** Bright zap path: zigzag lightning bolt spanning 8 world units horizontally.
 *
 * 5 points producing 4 line segments. All points lie in the XY plane (z=0)
 * with vertical offsets to simulate lightning branching.
 */
const brightPath: TeslaZapPath = {
  bright: true,
  points: [
    { x: -4, y: 0,   z: 0 },
    { x: -2, y: 0.8, z: 0 },
    { x:  0, y: -0.5,z: 0 },
    { x:  2, y: 0.6, z: 0 },
    { x:  4, y: 0,   z: 0 },
  ],
  palette: 'effect',
}

/** Dim zap path: shorter secondary branch offset downward.
 *
 * 4 points producing 3 line segments. Rendered with dim blue material
 * for a visual distinction from the bright main bolt.
 */
const dimPath: TeslaZapPath = {
  bright: false,
  points: [
    { x: -1, y: 0,    z: 0 },
    { x:  0, y: -1.2, z: 0 },
    { x:  1, y: -0.3, z: 0 },
    { x:  2, y: -0.8, z: 0 },
  ],
  palette: 'effect',
}

// ---------------------------------------------------------------------------
// TeslaZapMeshBuilder creation
// ---------------------------------------------------------------------------

let builder = TeslaZapMeshBuilder.createWithDefaults(scene, 42)

// ---------------------------------------------------------------------------
// Build zaps + save base vertex positions
// ---------------------------------------------------------------------------

/** Maps each LinesMesh to its original (pre-jitter) vertex positions. */
let basePositions = new Map<LinesMesh, Float32Array>()

function buildAndCache(): LinesMesh[] {
  const meshes = builder.buildZaps([brightPath, dimPath])
  basePositions.clear()
  for (const mesh of meshes) {
    const pos = mesh.getVerticesData('position')
    if (pos) {
      basePositions.set(mesh, new Float32Array(pos))
    }
  }
  return meshes
}

buildAndCache()

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let jitterEnabled = true
let tickCount = 0
let disposed = false
let jitterIntensity = 1.0

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

engine.runRenderLoop(() => {
  if (!disposed && jitterEnabled) {
    // Restore base positions before applying jitter.
    // This prevents cumulative position drift across frames —
    // each frame's jitter is computed from the original base positions,
    // making the effect deterministic for a given tickCount.
    for (const [mesh, base] of basePositions) {
      const copy = new Float32Array(base)
      mesh.updateVerticesData('position', copy, false, true)
    }
    builder.updateJitter(tickCount)
    tickCount += Math.max(1, Math.round(jitterIntensity))
  }

  scene.render()

  // Update UI
  updateUIState()
  document.getElementById('info-fps')!.textContent = engine.getFps().toFixed(0)
})

// ---------------------------------------------------------------------------
// UI state update
// ---------------------------------------------------------------------------

function updateUIState(): void {
  document.getElementById('state-tick')!.textContent = String(tickCount)

  const activeMeshes = disposed ? [] : builder.meshes
  document.getElementById('state-mesh-count')!.textContent = String(activeMeshes.length)

  let brightVerts = 0
  let dimVerts = 0
  let renderGroup = '-'
  for (const mesh of activeMeshes) {
    const pos = mesh.getVerticesData('position')
    const vertCount = pos ? pos.length / 3 : 0
    if (mesh.name.includes('Bright')) {
      brightVerts += vertCount
    } else {
      dimVerts += vertCount
    }
    if (renderGroup === '-') {
      renderGroup = String(mesh.renderingGroupId)
    }
  }
  document.getElementById('state-bright-verts')!.textContent = String(brightVerts)
  document.getElementById('state-dim-verts')!.textContent = String(dimVerts)
  document.getElementById('state-rendergroup')!.textContent = renderGroup
  document.getElementById('state-builder')!.textContent = disposed ? 'disposed' : 'active'
  document.getElementById('state-seed')!.textContent = '42'
}

// ---------------------------------------------------------------------------
// Info bar
// ---------------------------------------------------------------------------

function updateInfoBar(): void {
  const ua = navigator.userAgent
  document.getElementById('info-ua')!.textContent =
    ua.length > 60 ? ua.slice(0, 57) + '...' : ua
  document.getElementById('info-viewport')!.textContent =
    `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
  document.getElementById('info-engine')!.textContent =
    engine.webGLVersion >= 2 ? `WebGL ${engine.webGLVersion}.0` : 'Unknown'
  document.getElementById('info-time')!.textContent = new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Control bindings
// ---------------------------------------------------------------------------

// Rebuild Zaps
document.getElementById('btn-rebuild')!.addEventListener('click', () => {
  if (disposed) return
  buildAndCache()
  tickCount = 0
  updateUIState()
})

// Toggle Jitter
const jitterCheckbox = document.getElementById('toggle-jitter') as HTMLInputElement
jitterCheckbox.addEventListener('change', () => {
  jitterEnabled = jitterCheckbox.checked
  if (!jitterEnabled) {
    // Restore base positions when turning jitter off (freeze lines at original shape)
    for (const [mesh, base] of basePositions) {
      mesh.updateVerticesData('position', new Float32Array(base), false, true)
    }
  }
})

// Jitter Intensity slider
const intensitySlider = document.getElementById('intensity-slider') as HTMLInputElement
intensitySlider.addEventListener('input', () => {
  jitterIntensity = parseFloat(intensitySlider.value)
  document.getElementById('intensity-val')!.textContent = jitterIntensity.toFixed(1) + 'x'
})

// Dispose (Cleanup)
document.getElementById('btn-dispose')!.addEventListener('click', () => {
  if (disposed) return
  builder.dispose()
  basePositions.clear()
  disposed = true
  document.getElementById('state-mesh-count')!.textContent = '0'
  document.getElementById('state-bright-verts')!.textContent = '0'
  document.getElementById('state-dim-verts')!.textContent = '0'
  document.getElementById('state-rendergroup')!.textContent = '-'
  document.getElementById('state-builder')!.textContent = 'disposed'
})

// Recreate Builder (after dispose)
document.getElementById('btn-recreate')!.addEventListener('click', () => {
  if (!disposed) {
    // Dispose current first
    builder.dispose()
    basePositions.clear()
  }
  builder = TeslaZapMeshBuilder.createWithDefaults(scene, 42)
  disposed = false
  tickCount = 0
  buildAndCache()
  jitterCheckbox.checked = true
  jitterEnabled = true
  updateUIState()
})

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

updateInfoBar()
updateUIState()

window.addEventListener('resize', () => {
  document.getElementById('info-viewport')!.textContent =
    `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
})

setInterval(updateInfoBar, 2000)
