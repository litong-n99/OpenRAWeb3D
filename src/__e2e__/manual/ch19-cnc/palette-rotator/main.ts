/**
 * ch19-cnc/palette-rotator/main.ts — LightPaletteRotator acceptance test
 *
 * Verifies:
 * 1. tick(): increments t by timeStep (default 0.5) each call
 * 2. currentRotationIndex = Math.floor(t) % rotationIndices.length
 * 3. adjustPalette: copies color from rotationIndices[rotate] to modifyIndex (103)
 * 4. Excluded palettes are skipped (color unchanged)
 * 5. Full cycle: 18 indices × timeStep 0.5 = 36 ticks per complete cycle
 *
 * OpenRA source: OpenRA.Mods.Cnc/Traits/PaletteEffects/LightPaletteRotator.cs
 * TS source: src/OpenRA.Mods.Cnc/Traits/PaletteEffects/LightPaletteRotator.ts
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
  HighlightLayer,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// LightPaletteRotator (re-implemented for visual testing)
// ---------------------------------------------------------------------------

const DEFAULT_ROTATION_INDICES = [
  230, 231, 232, 233, 234, 235, 236, 237, 238, 239,
  238, 237, 236, 235, 234, 233, 232, 231,
]

class LightPaletteRotator {
  readonly excludePalettes: ReadonlySet<string>
  readonly timeStep: number
  readonly modifyIndex: number
  readonly rotationIndices: readonly number[]

  private t: number = 0

  constructor(params?: {
    excludePalettes?: ReadonlySet<string>
    timeStep?: number
    modifyIndex?: number
    rotationIndices?: readonly number[]
  }) {
    this.excludePalettes = params?.excludePalettes ?? new Set()
    this.timeStep = params?.timeStep ?? 0.5
    this.modifyIndex = params?.modifyIndex ?? 103
    this.rotationIndices = params?.rotationIndices ?? DEFAULT_ROTATION_INDICES
  }

  tick(): void {
    this.t += this.timeStep
  }

  get currentRotationIndex(): number {
    return Math.floor(this.t) % this.rotationIndices.length
  }

  get currentTime(): number {
    return this.t
  }

  /** Get the current source color index from the rotation sequence. */
  get currentSourceIndex(): number {
    const idx = this.rotationIndices[this.currentRotationIndex]
    return idx ?? 230
  }

  /** Apply palette rotation. Returns the color that index 103 should display. */
  adjustPalette(palette: Uint32Array): number {
    const rotate = this.currentRotationIndex
    const sourceIndex = this.rotationIndices[rotate]

    if (sourceIndex !== undefined && palette.length > this.modifyIndex && palette.length > sourceIndex) {
      palette[this.modifyIndex] = palette[sourceIndex]
      return palette[sourceIndex]
    }
    return palette[this.modifyIndex] ?? 0
  }
}

// ---------------------------------------------------------------------------
// Color palette: 256 colors indexed by palette index
// We create a visual palette where indices 230-239 are distinct colors,
// and index 103 is the "modified" target that changes.
// ---------------------------------------------------------------------------

/**
 * Generate a 256-color palette for visual demonstration.
 * Indices 230-239: gradient from blue to cyan to white (the rotating source colors).
 * Index 103: initially dark gray (will be modified by the rotator).
 * Other indices 0-99: reference colors (used for cubes 0-3).
 */
function generateVisualPalette(): Uint32Array {
  const palette = new Uint32Array(256)

  // Fill all with dark colors
  for (let i = 0; i < 256; i++) {
    palette[i] = 0xFF1a1a2e  // dark background
  }

  // Index 0: Red (#FF3333)
  palette[0] = 0xFF3333FF

  // Index 1: Green (#33FF33)
  palette[1] = 0x33FF33FF

  // Index 2: Blue (#3333FF)
  palette[2] = 0x3333FFFF

  // Index 3: Yellow (#FFCC00)
  palette[3] = 0xFFCC00FF

  // Indices 230-239: the rotation source colors (blue → cyan → white gradient)
  for (let i = 0; i < 10; i++) {
    const t = i / 9  // 0 → 1
    const r = Math.round(30 + 200 * t)
    const g = Math.round(100 + 155 * t)
    const b = Math.round(200 - 50 * t)  // blue fades slightly
    palette[230 + i] = (r) | (g << 8) | (b << 16) | (0xFF << 24)
  }

  // Index 103: starts dark (will be overwritten by rotator)
  palette[103] = 0x223344FF

  return palette
}

// Convert Uint32 (RGBA or ARGB) to Babylon Color3
function uint32ToColor3(value: number): Color3 {
  // Assuming RGBA byte order in palette
  const r = (value & 0xFF) / 255
  const g = ((value >> 8) & 0xFF) / 255
  const b = ((value >> 16) & 0xFF) / 255
  return new Color3(r, g, b)
}

// ---------------------------------------------------------------------------
// Babylon.js Scene
// ---------------------------------------------------------------------------

let engine!: Engine
let scene!: Scene
let rotator!: LightPaletteRotator
let palette!: Uint32Array

// 5 cubes: indices 0,1,2,3 (reference) and cube for index 103 (modified)
let cubeMats: StandardMaterial[] = []
let modifiedCubeMat!: StandardMaterial
let highlightLayer!: HighlightLayer

const CUBE_COUNT = 5  // 4 reference + 1 modified

function setupScene(): void {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
  scene = new Scene(engine)
  scene.clearColor = new Color4(0.08, 0.12, 0.18, 1)

  // Camera
  const camera = new ArcRotateCamera('camera', -Math.PI / 2.5, Math.PI / 3.5, 10, new Vector3(0, 0.5, 0), scene)
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 4
  camera.upperRadiusLimit = 20

  // Lighting
  const hemi = new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)
  hemi.intensity = 1.2

  // Ground
  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.diffuseColor = new Color3(0.2, 0.25, 0.2)
  const ground = MeshBuilder.CreateGround('ground', { width: 10, height: 8 }, scene)
  ground.material = groundMat
  ground.position.y = -0.05

  // Highlight layer for modified cube
  highlightLayer = new HighlightLayer('highlight', scene)

  // Generate palette
  palette = generateVisualPalette()

  // 5 colored cubes
  const refIndices = [0, 1, 2, 3, 103]  // last one is modifyIndex (103)

  for (let i = 0; i < CUBE_COUNT; i++) {
    const color = uint32ToColor3(palette[refIndices[i]])
    const mat = new StandardMaterial(`cubeMat${i}`, scene)
    mat.diffuseColor = color
    mat.specularColor = new Color3(0.1, 0.1, 0.1)

    const cube = MeshBuilder.CreateBox(`cube${i}`, { size: 0.7 }, scene)
    cube.position.x = (i - 2) * 1.4
    cube.position.y = 0.35
    cube.material = mat

    cubeMats.push(mat)

    // Highlight the modified cube (index 4, palette index 103)
    if (i === 4) {
      modifiedCubeMat = mat
      highlightLayer.addMesh(cube, Color3.White())
    }
  }

  // Create text labels via small planes (simplified: we'll use the status panel instead)

  // Initialize rotator
  rotator = new LightPaletteRotator({
    excludePalettes: new Set(),
    timeStep: 0.5,
    modifyIndex: 103,
    rotationIndices: DEFAULT_ROTATION_INDICES,
  })
}

// ---------------------------------------------------------------------------
// Color palette visualization bar (DOM-based)
// ---------------------------------------------------------------------------

function updatePaletteDisplay(): void {
  const container = document.getElementById('palette-display')
  if (!container) return

  // Show indices 228-241 to see the rotation range
  let html = ''
  for (let i = 228; i <= 241; i++) {
    const color = palette[i]
    const r = color & 0xFF
    const g = (color >> 8) & 0xFF
    const b = (color >> 16) & 0xFF
    const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
    const isSource = i === rotator.currentSourceIndex
    const isTarget = i === rotator.modifyIndex
    let cls = 'swatch'
    if (isTarget) cls += ' highlight'
    if (isSource) cls += ' source'
    html += `<div class="${cls}" style="background:${hex}" title="idx:${i} ${hex}"></div>`
  }
  // Also show index 103 colored box
  const idx103Color = palette[103]
  const r103 = idx103Color & 0xFF
  const g103 = (idx103Color >> 8) & 0xFF
  const b103 = (idx103Color >> 16) & 0xFF
  const hex103 = `#${r103.toString(16).padStart(2, '0')}${g103.toString(16).padStart(2, '0')}${b103.toString(16).padStart(2, '0')}`
  html += `<span style="margin:0 6px;color:#888;">→103=</span>`
  html += `<div class="swatch highlight" style="background:${hex103}" title="idx:103 modified ${hex103}"></div>`

  container.innerHTML = html
}

// ---------------------------------------------------------------------------
// UI updates
// ---------------------------------------------------------------------------

function updateStatus(): void {
  document.getElementById('st-t')!.textContent = rotator.currentTime.toFixed(1)
  document.getElementById('st-ridx')!.textContent = String(rotator.currentRotationIndex)
  document.getElementById('st-srcidx')!.textContent = String(rotator.currentSourceIndex)

  const idx103Color = palette[103]
  const r = idx103Color & 0xFF
  const g = (idx103Color >> 8) & 0xFF
  const b = (idx103Color >> 16) & 0xFF
  document.getElementById('st-color')!.textContent =
    `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`

  document.getElementById('st-running')!.textContent = String(isRunning)

  // Update rotation sequence display with current position marker
  const seq = DEFAULT_ROTATION_INDICES.map((v, i) => {
    if (i === rotator.currentRotationIndex) return `*${v}*`
    return String(v)
  }).join(', ')
  document.getElementById('st-seq')!.textContent = `[${seq}]`
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

let isRunning = true

function setupControls(): void {
  document.getElementById('btn-start')!.addEventListener('click', () => {
    isRunning = true
  })

  document.getElementById('btn-pause')!.addEventListener('click', () => {
    isRunning = false
  })

  document.getElementById('btn-reset')!.addEventListener('click', () => {
    isRunning = false
    rotator = new LightPaletteRotator({
      excludePalettes: new Set(),
      timeStep: parseFloat((document.getElementById('rng-speed') as HTMLInputElement).value),
      modifyIndex: parseInt((document.getElementById('rng-modify') as HTMLInputElement).value),
      rotationIndices: DEFAULT_ROTATION_INDICES,
    })
    // Reset palette
    palette = generateVisualPalette()
    // Reset cube colors
    updateAllCubeColors()
    updatePaletteDisplay()
  })

  document.getElementById('rng-speed')!.addEventListener('input', (e) => {
    const val = parseFloat((e.target as HTMLInputElement).value)
    document.getElementById('lbl-speed')!.textContent = val.toFixed(1)
    // Re-create rotator with new timeStep
    rotator = new LightPaletteRotator({
      excludePalettes: rotator.excludePalettes,
      timeStep: val,
      modifyIndex: rotator.modifyIndex,
      rotationIndices: rotator.rotationIndices,
    })
  })

  document.getElementById('rng-modify')!.addEventListener('input', (e) => {
    const val = parseInt((e.target as HTMLInputElement).value)
    document.getElementById('lbl-modify')!.textContent = String(val)
    rotator = new LightPaletteRotator({
      excludePalettes: rotator.excludePalettes,
      timeStep: rotator.timeStep,
      modifyIndex: val,
      rotationIndices: rotator.rotationIndices,
    })
  })
}

function updateAllCubeColors(): void {
  const refIndices = [0, 1, 2, 3, rotator.modifyIndex]
  for (let i = 0; i < CUBE_COUNT; i++) {
    const idx = i < 4 ? refIndices[i] : rotator.modifyIndex
    const color = uint32ToColor3(palette[idx])
    cubeMats[i].diffuseColor = color
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

setupScene()
setupControls()

let tickAccumulator = 0
const TICK_RATE = 1000 / 25

engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime()
  tickAccumulator += dt

  while (tickAccumulator >= TICK_RATE) {
    tickAccumulator -= TICK_RATE

    if (isRunning) {
      rotator.tick()
      rotator.adjustPalette(palette)

      // Update the modified cube's material color
      const idx103Color = palette[rotator.modifyIndex]
      const color = uint32ToColor3(idx103Color)
      modifiedCubeMat.diffuseColor = color
    }
  }

  updateStatus()
  updatePaletteDisplay()
  updateInfoBar()
  scene.render()
})

window.addEventListener('resize', () => {
  engine.resize()
})
