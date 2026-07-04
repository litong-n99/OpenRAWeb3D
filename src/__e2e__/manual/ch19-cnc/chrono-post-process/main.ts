/**
 * ch19-cnc/chrono-post-process/main.ts — ChronoshiftPostProcessEffect acceptance test
 *
 * Verifies:
 * 1. Enable() sets remainingFrames = chronoEffectLength
 * 2. tick() decrements remainingFrames by 1 each call
 * 3. blendFactor = remainingFrames / chronoEffectLength, linear decay 1.0→0.0
 * 4. After 60 ticks: enabled=false, blendFactor=0.0
 * 5. Re-enable during active effect resets to full duration
 *
 * The actual Babylon.js PostProcess (chroma-shift shader) is deferred to Phase C,
 * but this test simulates the visual effect by applying a color overlay on the
 * scene based on the blend factor, allowing manual verification of the fade curve.
 *
 * OpenRA source: OpenRA.Mods.Cnc/Traits/PaletteEffects/ChronoshiftPostProcessEffect.cs
 * TS source: src/OpenRA.Mods.Cnc/Traits/PaletteEffects/ChronoshiftPostProcessEffect.ts
 */

import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  Vector3,
  Color4,
  Color3,
  MeshBuilder,
  StandardMaterial,
  PostProcess,
  Effect,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// ChronoshiftPostProcessEffect (re-implemented for visual testing)
// ---------------------------------------------------------------------------

class ChronoshiftPostProcessEffect {
  readonly chronoEffectLength: number
  private _remainingFrames: number = 0
  readonly passName: string = 'chronoshift'

  constructor(chronoEffectLength: number = 60) {
    this.chronoEffectLength = chronoEffectLength
  }

  tick(): void {
    if (this._remainingFrames > 0) {
      this._remainingFrames--
    }
  }

  enable(): void {
    this._remainingFrames = this.chronoEffectLength
  }

  get enabled(): boolean {
    return this._remainingFrames > 0
  }

  get blendFactor(): number {
    if (!this.enabled || this.chronoEffectLength <= 0) return 0
    return this._remainingFrames / this.chronoEffectLength
  }

  get remainingFrames(): number {
    return this._remainingFrames
  }
}

// ---------------------------------------------------------------------------
// Babylon.js Scene
// ---------------------------------------------------------------------------

let engine!: Engine
let scene!: Scene
let effectInstance!: ChronoshiftPostProcessEffect
let chromaPostProcess: PostProcess | null = null

/** Base color for scene background clearing (before overlay). */
const CLEAR_COLOR = new Color4(0.08, 0.12, 0.18, 1)

/** Chroma shift target color (blue-shift for Tiberian Sun chrono effect). */
const CHROMA_BLUE = new Color3(0.15, 0.25, 0.6)
const CHROMA_RED = new Color3(0.6, 0.15, 0.15)
const CHROMA_GREEN = new Color3(0.15, 0.6, 0.15)

let chromaColor = CHROMA_BLUE

function setupScene(): void {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
  scene = new Scene(engine)
  scene.clearColor = CLEAR_COLOR

  // Camera
  const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 4, 8, new Vector3(0, 0, 0), scene)
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 2
  camera.upperRadiusLimit = 20

  // Lights
  const hemi = new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)
  hemi.intensity = 1.2

  // Scene objects (test targets for visual verification)
  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.diffuseColor = new Color3(0.3, 0.35, 0.3)

  const ground = MeshBuilder.CreateGround('ground', { width: 8, height: 8 }, scene)
  ground.material = groundMat
  ground.position.y = -0.05

  // Colored reference cubes
  const colors = [
    new Color3(0.9, 0.2, 0.2), // red
    new Color3(0.2, 0.9, 0.2), // green
    new Color3(0.2, 0.2, 0.9), // blue
    new Color3(0.9, 0.9, 0.2), // yellow
    new Color3(0.9, 0.5, 0.1), // orange
  ]

  for (let i = 0; i < 5; i++) {
    const cubeMat = new StandardMaterial(`cubeMat${i}`, scene)
    cubeMat.diffuseColor = colors[i]
    cubeMat.specularColor = new Color3(0.1, 0.1, 0.1)

    const cube = MeshBuilder.CreateBox(`cube${i}`, { size: 0.8 }, scene)
    cube.position.x = (i - 2) * 1.5
    cube.position.y = 0.4
    cube.material = cubeMat
  }

  // Torus ring for visual interest
  const ringMat = new StandardMaterial('ringMat', scene)
  ringMat.diffuseColor = new Color3(0.7, 0.7, 0.8)
  ringMat.emissiveColor = new Color3(0.1, 0.1, 0.15)

  const ring = MeshBuilder.CreateTorus('ring', { diameter: 2, thickness: 0.2 }, scene)
  ring.position.y = 1.5
  ring.material = ringMat

  // Setup the chrono post-process (simulated via scene-level color overlay)
  // In real implementation, this would be a custom PostProcess with chroma-shift shader.
  // For visual testing, we apply a semi-transparent overlay color via a PostProcess.

  // BUGFIX ch19: PostProcess requires BOTH vertex + fragment shaders.
  // Babylon.js v9 throws 'Cannot read properties of undefined' when only
  // the fragment shader is registered (DrawWrapper needs the pair).
  Effect.ShadersStore['chromaShiftVertexShader'] = `
    precision highp float;
    attribute vec2 position;
    varying vec2 vUV;
    void main(void) {
      vUV = position * 0.5 + 0.5;
      gl_Position = vec4(position, 0.0, 1.0);
    }
  `;

  Effect.ShadersStore['chromaShiftPixelShader'] = `
    varying vec2 vUV;
    uniform sampler2D textureSampler;
    uniform vec3 chromaColor;
    uniform float blendFactor;
    void main(void) {
      vec4 base = texture2D(textureSampler, vUV);
      vec3 shifted = mix(base.rgb, chromaColor, blendFactor * 0.4);
      gl_FragColor = vec4(shifted, base.a);
    }
  `

  chromaPostProcess = new PostProcess(
    'chromaShift',
    'chromaShift',
    ['chromaColor', 'blendFactor'],
    null,
    1.0,
    camera, // BUGFIX ch19: Babylon v9 PostProcess requires camera (not null) for engine ref
  )
  chromaPostProcess.onApply = (effect) => {
    const color = chromaColor
    effect.setFloat3('chromaColor', color.r, color.g, color.b)
    effect.setFloat('blendFactor', effectInstance.blendFactor)
  }

  // Start with effect inactive
  effectInstance = new ChronoshiftPostProcessEffect(60)
}

// ---------------------------------------------------------------------------
// UI updates
// ---------------------------------------------------------------------------

function updateStatus(): void {
  const eff = effectInstance
  document.getElementById('st-enabled')!.textContent = eff.enabled ? '激活中' : '未激活'
  document.getElementById('st-blend')!.textContent = eff.blendFactor.toFixed(3)
  document.getElementById('st-remaining')!.textContent = String(eff.remainingFrames)
  document.getElementById('st-total')!.textContent = String(eff.chronoEffectLength)

  const passed = eff.chronoEffectLength - eff.remainingFrames
  document.getElementById('st-ticks')!.textContent = String(passed)

  // Progress bar
  const pct = eff.chronoEffectLength > 0
    ? Math.round((passed / eff.chronoEffectLength) * 100)
    : 0
  const barLen = 20
  const filled = Math.round((pct / 100) * barLen)
  const bar = '[' + '#'.repeat(filled) + '_'.repeat(barLen - filled) + ']'
  document.getElementById('st-bar')!.textContent = `${bar} ${pct}%`
}

function updateInfoBar(): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  document.getElementById('info-viewport')!.textContent = `${window.innerWidth}x${window.innerHeight}`
  document.getElementById('info-engine')!.textContent = engine.webGLVersion === 2 ? 'WebGL 2.0' : 'WebGL 1.0'
  document.getElementById('info-fps')!.textContent = String(Math.round(engine.getFps()))
  document.getElementById('info-time')!.textContent = new Date().toISOString()
  document.getElementById('info-tickrate')!.textContent = '25 ticks/s'
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function setupControls(): void {
  document.getElementById('btn-activate')!.addEventListener('click', () => {
    effectInstance.enable()
    document.getElementById('btn-activate')!.classList.add('active')
  })

  document.getElementById('sel-duration')!.addEventListener('change', (e) => {
    const val = parseInt((e.target as HTMLSelectElement).value)
    effectInstance = new ChronoshiftPostProcessEffect(val)
    document.getElementById('st-total')!.textContent = String(val)
  })

  document.getElementById('sel-mode')!.addEventListener('change', (e) => {
    const mode = (e.target as HTMLSelectElement).value
    switch (mode) {
      case 'chroma': chromaColor = CHROMA_BLUE; break
      case 'red': chromaColor = CHROMA_RED; break
      case 'green': chromaColor = CHROMA_GREEN; break
    }
  })

  document.getElementById('btn-reset')!.addEventListener('click', () => {
    effectInstance = new ChronoshiftPostProcessEffect(
      parseInt((document.getElementById('sel-duration') as HTMLSelectElement).value),
    )
    document.getElementById('btn-activate')!.classList.remove('active')
    updateStatus()
  })
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

setupScene()
setupControls()

let tickAccumulator = 0
const TICK_RATE = 1000 / 25 // 25 ticks/s

engine.runRenderLoop(() => {
  const deltaTime = engine.getDeltaTime()
  tickAccumulator += deltaTime

  while (tickAccumulator >= TICK_RATE) {
    tickAccumulator -= TICK_RATE
    effectInstance.tick()
  }

  updateStatus()
  updateInfoBar()
  scene.render()
})

window.addEventListener('resize', () => {
  engine.resize()
})
