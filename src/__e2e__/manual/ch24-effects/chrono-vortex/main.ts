/**
 * main.ts — ChronoVortexRenderable 3D Spiral Billboard 人工验收测试
 *
 * 测试目标:
 *   1. Billboard with BILLBOARDMODE_ALL — 始终面向摄像机
 *   2. ChronoVortexShaderMaterial — 程序化螺旋片段着色器 (atan2 + radius distortion)
 *   3. tickUpdate(tickCount) — 基于游戏 tick 的动画计时 (40ms/tick)
 *   4. Progress fade — 0→1 生命周期淡出 (frame/47)
 *   5. renderingGroupId = RenderGroup.Actor (1)
 *   6. dispose() — 正确清理 GPU 资源
 *
 * OpenRA 对照: ChronoVortexRenderable (OpenRA.Mods.Cnc/Graphics/ChronoVortexRenderable.cs)
 * Ch24 Phase C: Vortex 3D Polish
 */

import { Engine } from '@babylonjs/core'
import { Scene } from '@babylonjs/core'
import { ArcRotateCamera } from '@babylonjs/core'
import { HemisphericLight } from '@babylonjs/core'
import { Vector3 } from '@babylonjs/core'
import { Color3, Color4 } from '@babylonjs/core'
import { MeshBuilder } from '@babylonjs/core'
import { StandardMaterial } from '@babylonjs/core'
import { Mesh } from '@babylonjs/core'


import {
  ChronoVortexRenderable,
  type IChronoVortexRendererAccess,
  type IChronoVortexWorldRenderer,
} from '../../../../OpenRA.Mods.Cnc/Graphics/ChronoVortexRenderable.js'
import { WPos } from '../../../../OpenRA.Game/WPos.js'

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
  Math.PI / 4,    // beta: 45 degrees elevation
  10,             // radius
  Vector3.Zero(), // target
  scene,
)
camera.lowerRadiusLimit = 3
camera.upperRadiusLimit = 30
camera.attachControl(canvas, true)

// Minimal ambient light — vortex is emissive (shader-driven) so light is
// decorative; included for spatial context on reference objects
const light = new HemisphericLight('testLight', new Vector3(0, 1, 0), scene)
light.intensity = 0.3

// ---------------------------------------------------------------------------
// Reference ground grid (spatial context for billboard position and orientation)
// ---------------------------------------------------------------------------

const gridMat = new StandardMaterial('gridMat', scene)
gridMat.diffuseColor = new Color3(0.06, 0.06, 0.08)
gridMat.specularColor = Color3.Black()
gridMat.backFaceCulling = false
gridMat.alpha = 0.4

const gridPlane = MeshBuilder.CreatePlane(
  'gridPlane',
  { width: 12, height: 12 },
  scene,
)
gridPlane.material = gridMat
gridPlane.position.set(0, 0, -0.1)
gridPlane.renderingGroupId = 0

// Crosshair lines to mark world origin
const crossH = MeshBuilder.CreateLines(
  'crossH',
  {
    points: [
      new Vector3(-1, 0, 0.01),
      new Vector3(1, 0, 0.01),
    ],
    colors: [new Color4(0.3, 0.3, 0.3, 0.6), new Color4(0.3, 0.3, 0.3, 0.6)],
  },
  scene,
)
crossH.renderingGroupId = 0

const crossV = MeshBuilder.CreateLines(
  'crossV',
  {
    points: [
      new Vector3(0, -1, 0.01),
      new Vector3(0, 1, 0.01),
    ],
    colors: [new Color4(0.3, 0.3, 0.3, 0.6), new Color4(0.3, 0.3, 0.3, 0.6)],
  },
  scene,
)
crossV.renderingGroupId = 0

// ---------------------------------------------------------------------------
// Mock renderer + world renderer
// ---------------------------------------------------------------------------

const mockRenderer: IChronoVortexRendererAccess = {
  drawVortex(_pos, _frame) {
    // 2D fallback path — not exercised in 3D test mode
  },
}

const mockWorldRenderer: IChronoVortexWorldRenderer = {
  screen3DPxPosition(pos: WPos): { x: number; y: number; z: number } {
    return { x: pos.X, y: pos.Y, z: pos.Z }
  },
}

// ---------------------------------------------------------------------------
// Color presets
// ---------------------------------------------------------------------------

const colorPresets: Record<string, Color3> = {
  cyan: new Color3(0.2, 0.8, 1.0),
  purple: new Color3(0.8, 0.27, 1.0),
  orange: new Color3(1.0, 0.53, 0.2),
  green: new Color3(0.2, 1.0, 0.53),
  red: new Color3(1.0, 0.2, 0.27),
}

let currentColorPreset = 'cyan'

// ---------------------------------------------------------------------------
// Vortex instance management
// ---------------------------------------------------------------------------

let vortex: ChronoVortexRenderable | null = null
let disposed = false

function createVortex(frame: number): void {
  // Dispose existing vortex if any
  if (vortex) {
    vortex.dispose()
  }

  vortex = new ChronoVortexRenderable(
    mockRenderer,
    WPos.Zero,
    frame,
    scene,
    undefined, // no shared material (per-instance for color control)
    1,          // renderingGroupId = RenderGroup.Actor
  )

  // Initial render to create the billboard and shader material
  vortex.render(mockWorldRenderer)

  // Override the shader material color after render (since render3D creates the material)
  applyCurrentColor()

  disposed = false
}

/** Apply current color preset to the vortex shader material. */
function applyCurrentColor(): void {
  if (vortex?.shaderMaterial) {
    vortex.shaderMaterial.setColor(colorPresets[currentColorPreset]!)
  }
}

// ---------------------------------------------------------------------------
// Animation state
// ---------------------------------------------------------------------------

let isPlaying = true
let tickCount = 0
let currentFrame = 0
let autoAdvance = false
let ticksSinceAdvance = 0
let autoAdvanceInterval = 25  // ticks per frame step

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

engine.runRenderLoop(() => {
  if (!disposed && isPlaying) {
    // Increment tick count (equivalent to game tick at 25 ticks/s)
    const tpf = parseInt(
      (document.getElementById('tpf-slider') as HTMLInputElement)?.value ?? '1',
      10,
    )
    tickCount += Math.max(1, tpf)

    // Auto-advance frame for lifecycle demo
    if (autoAdvance) {
      ticksSinceAdvance += tpf
      if (ticksSinceAdvance >= autoAdvanceInterval) {
        ticksSinceAdvance -= autoAdvanceInterval
        currentFrame = (currentFrame + 1) % 48
        createVortex(currentFrame)
      }
    }

    // Update vortex animation via tick-based timing
    vortex?.tickUpdate(tickCount)
  }

  // Always call render to keep billboard positioned at world coordinates
  vortex?.render(mockWorldRenderer)

  // Scene render
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
  document.getElementById('state-time')!.textContent = (tickCount * 0.04).toFixed(2)
  document.getElementById('state-progress')!.textContent = (currentFrame / 47).toFixed(2)
  document.getElementById('frame-val')!.textContent = String(currentFrame)

  // Progress bar
  const progressPct = (currentFrame / 47) * 100
  const progressBar = document.getElementById('progress-fill')!
  progressBar.style.width = `${progressPct}%`

  // Vortex billboard info
  if (vortex && !disposed) {
    const bb = vortex.billboard
    if (bb) {
      document.getElementById('state-rendergroup')!.textContent = String(bb.renderingGroupId)
      document.getElementById('state-bbmode')!.textContent =
        bb.billboardMode === Mesh.BILLBOARDMODE_ALL ? 'BILLBOARDMODE_ALL (7)' : String(bb.billboardMode)
      document.getElementById('state-position')!.textContent =
        `(${bb.position.x.toFixed(0)}, ${bb.position.y.toFixed(0)}, ${bb.position.z.toFixed(0)})`
      document.getElementById('state-material')!.textContent =
        bb.material ? 'ShaderMaterial (ChronoVortex)' : 'null'
      document.getElementById('state-culling')!.textContent =
        bb.material && (bb.material as any).backFaceCulling === false ? 'false (disabled)' : 'true'

      // Alpha blending detection
      const mat = bb.material as any
      if (mat?.needAlphaBlending) {
        document.getElementById('state-alpha')!.textContent =
          `enabled (needAlphaBlending=${mat.needAlphaBlending()})`
      } else {
        document.getElementById('state-alpha')!.textContent = 'unknown'
      }
    }
  } else {
    document.getElementById('state-rendergroup')!.textContent = '-'
    document.getElementById('state-bbmode')!.textContent = '-'
    document.getElementById('state-position')!.textContent = '-'
    document.getElementById('state-material')!.textContent = '-'
    document.getElementById('state-alpha')!.textContent = '-'
    document.getElementById('state-culling')!.textContent = '-'
  }
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

// Play
document.getElementById('btn-play')!.addEventListener('click', () => {
  isPlaying = true
  document.getElementById('btn-play')!.classList.add('active')
  document.getElementById('btn-pause')!.classList.remove('active')
})

// Pause
document.getElementById('btn-pause')!.addEventListener('click', () => {
  isPlaying = false
  document.getElementById('btn-play')!.classList.remove('active')
  document.getElementById('btn-pause')!.classList.add('active')
})

// Speed slider (controls render-loop tick accumulation factor)
const speedSlider = document.getElementById('speed-slider') as HTMLInputElement
speedSlider.addEventListener('input', () => {
  document.getElementById('speed-val')!.textContent = parseFloat(speedSlider.value).toFixed(1) + 'x'
})

// TPF (ticks per frame) slider
const tpfSlider = document.getElementById('tpf-slider') as HTMLInputElement
tpfSlider.addEventListener('input', () => {
  document.getElementById('tpf-val')!.textContent = tpfSlider.value
})

// Frame slider
const frameSlider = document.getElementById('frame-slider') as HTMLInputElement
frameSlider.addEventListener('input', () => {
  if (disposed) return
  currentFrame = parseInt(frameSlider.value, 10)
  createVortex(currentFrame)
  ticksSinceAdvance = 0
  updateUIState()
})

// Auto-advance toggle
document.getElementById('toggle-autoadvance')!.addEventListener('change', (e) => {
  autoAdvance = (e.target as HTMLInputElement).checked
  ticksSinceAdvance = 0
})

// Auto-advance interval slider
const autoIntervalSlider = document.getElementById('auto-interval-slider') as HTMLInputElement
autoIntervalSlider.addEventListener('input', () => {
  autoAdvanceInterval = parseInt(autoIntervalSlider.value, 10)
  document.getElementById('ai-val')!.textContent = String(autoAdvanceInterval)
})

// Color preset
document.getElementById('color-preset')!.addEventListener('change', (e) => {
  currentColorPreset = (e.target as HTMLSelectElement).value
  applyCurrentColor()
  // Update color swatch
  const c = colorPresets[currentColorPreset]!
  const swatch = document.getElementById('color-swatch')!
  swatch.style.background = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`
})

// Dispose
document.getElementById('btn-dispose')!.addEventListener('click', () => {
  if (disposed || !vortex) return
  vortex.dispose()
  vortex = null
  disposed = true
  updateUIState()
})

// Recreate
document.getElementById('btn-recreate')!.addEventListener('click', () => {
  if (vortex && !disposed) {
    vortex.dispose()
  }
  vortex = null
  createVortex(currentFrame)
  tickCount = 0
  ticksSinceAdvance = 0
  disposed = false

  // Reset UI buttons
  document.getElementById('btn-play')!.classList.add('active')
  document.getElementById('btn-pause')!.classList.remove('active')
  isPlaying = true

  updateUIState()
})

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

createVortex(0)
updateInfoBar()
updateUIState()
document.getElementById('btn-play')!.classList.add('active')

window.addEventListener('resize', () => {
  document.getElementById('info-viewport')!.textContent =
    `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
})

setInterval(updateInfoBar, 2000)
