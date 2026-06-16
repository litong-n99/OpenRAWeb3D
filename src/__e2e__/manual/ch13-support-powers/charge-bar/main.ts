/**
 * support-powers/charge-bar/main.ts — SupportPowerChargeBar visual acceptance test
 *
 * Verifies:
 * 1. Charge progress bar rendering: 0% empty, 50% half, 100% full
 * 2. Bar color matches configured color (default Magenta #FF00FF)
 * 3. DisplayWhenEmpty: bar hides when charge is 0% and DisplayWhenEmpty=false
 * 4. Trait disabled state: bar hides when building is disabled/paused
 *
 * Architecture:
 *   - Simulated building (box mesh) with charge bar plane above it
 *   - DynamicTexture-based bar fill driven by chargeProgress (0.0-1.0)
 *   - Color configurable via color picker and presets
 *   - State toggles: Active / Disabled / Paused
 *
 * OpenRA comparison:
 *   SupportPowerChargeBar.getValue() returns 1 - remainingTicks / totalTicks
 *   SupportPowerChargeBar.getColor() returns info.color (default Magenta)
 *   SupportPowerChargeBar.displayWhenEmpty = false (hidden when empty)
 *   Trait disabled → getValue() returns 0 → bar hidden
 */

import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  Vector3,
  Color4,
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  Color3,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Charge Bar Configuration
// ---------------------------------------------------------------------------

/** Total charge ticks (chargeInterval). */
const TOTAL_TICKS = 2500
/** Width of the bar in world units. */
const BAR_WIDTH = 3.0
/** Height of the bar in world units. */
const BAR_HEIGHT = 0.25
/** Bar background color (dark). */
const BAR_BG_RGB = { r: 0.15, g: 0.15, b: 0.15 }
// DEFAULT_FILL_RGB kept as reference: { r: 1.0, g: 0.0, b: 1.0 }

// ---------------------------------------------------------------------------
// State variables (mirrors SupportPowerChargeBar logic)
// ---------------------------------------------------------------------------

let chargeProgress = 0.3 // 0.0 = empty, 1.0 = fully charged
let barColorHex = '#ff00ff'
let isActive = true
let isDisabled = false
let isPaused = false
let displayWhenEmpty = false // matches OpenRA default

// ---------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------

function isBarVisible(): boolean {
  // Mirror SupportPowerChargeBar.getValue() logic:
  // - disabled → 0 (bar hidden)
  // - displayWhenEmpty=false AND progress==0 → hidden
  // - otherwise visible
  if (!isActive || isDisabled || isPaused) return false
  if (!displayWhenEmpty && chargeProgress <= 0) return false
  return true
}

// getChargeProgress() kept as reference inline

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const v = parseInt(hex.replace('#', ''), 16)
  return {
    r: ((v >> 16) & 0xff) / 255,
    g: ((v >> 8) & 0xff) / 255,
    b: (v & 0xff) / 255,
  }
}

// ---------------------------------------------------------------------------
// Canvas-based bar rendering
// ---------------------------------------------------------------------------

const BAR_TEX_W = 512
const BAR_TEX_H = 128

function buildBarTexture(ctx: CanvasRenderingContext2D, progress: number, colorHex: string, visible: boolean): void {
  ctx.clearRect(0, 0, BAR_TEX_W, BAR_TEX_H)

  if (!visible) {
    // Draw fully transparent
    return
  }

  const rgb = hexToRgb(colorHex)
  const bgColor = `rgb(${BAR_BG_RGB.r * 255}, ${BAR_BG_RGB.g * 255}, ${BAR_BG_RGB.b * 255})`
  const fillColor = `rgb(${rgb.r * 255}, ${rgb.g * 255}, ${rgb.b * 255})`

  // Bar background (full width)
  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, BAR_TEX_W, BAR_TEX_H)

  // Bar frame/border
  ctx.strokeStyle = '#444'
  ctx.lineWidth = 3
  ctx.strokeRect(2, 2, BAR_TEX_W - 4, BAR_TEX_H - 4)

  // Bar fill (progress fraction)
  const fillW = Math.round(progress * (BAR_TEX_W - 8))
  if (fillW > 0) {
    ctx.fillStyle = fillColor
    ctx.fillRect(4, 4, fillW, BAR_TEX_H - 8)
  }

  // Progress text
  const pct = Math.round(progress * 100)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 36px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`${pct}%`, BAR_TEX_W / 2, BAR_TEX_H / 2)
}

// ---------------------------------------------------------------------------
// Babylon.js Scene
// ---------------------------------------------------------------------------

let dynamicTexture: DynamicTexture | null = null
let barPlane: import('@babylonjs/core').AbstractMesh | null = null

function setupScene(): { engine: Engine; scene: Scene } {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: false,
  })
  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.12, 0.14, 0.18, 1)

  // Camera — angled view of the building + charge bar
  const camera = new ArcRotateCamera(
    'camera',
    -Math.PI / 3,
    Math.PI / 4,
    8,
    new Vector3(0, 1.5, 0),
    scene,
  )
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 3
  camera.upperRadiusLimit = 20

  // Lights
  new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)
    .diffuse = new Color3(0.8, 0.8, 0.8)

  // -------------------------------------------------------------------------
  // Ground plane
  // -------------------------------------------------------------------------

  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.diffuseColor = new Color3(0.25, 0.28, 0.22)
  groundMat.specularColor = new Color3(0, 0, 0)

  const ground = MeshBuilder.CreateGround('ground', { width: 10, height: 10 }, scene)
  ground.position.y = 0.01
  ground.material = groundMat

  // -------------------------------------------------------------------------
  // Building body (box)
  // -------------------------------------------------------------------------

  const buildingMat = new StandardMaterial('buildingMat', scene)
  buildingMat.diffuseColor = new Color3(0.4, 0.5, 0.6)
  buildingMat.specularColor = new Color3(0.1, 0.1, 0.1)

  const building = MeshBuilder.CreateBox(
    'building',
    { width: 2.0, height: 1.5, depth: 1.5 },
    scene,
  )
  building.position = new Vector3(0, 0.75, 0)
  building.material = buildingMat

  // -------------------------------------------------------------------------
  // Charge bar overlay (plane above the building)
  // -------------------------------------------------------------------------

  dynamicTexture = new DynamicTexture(
    'chargeBarTex',
    { width: BAR_TEX_W, height: BAR_TEX_H },
    scene,
    false,
  )
  const ctx = dynamicTexture.getContext() as CanvasRenderingContext2D
  buildBarTexture(ctx, chargeProgress, barColorHex, isBarVisible())
  dynamicTexture.update(false)

  const barMat = new StandardMaterial('barMat', scene)
  barMat.diffuseTexture = dynamicTexture
  barMat.specularColor = new Color3(0, 0, 0)
  barMat.useAlphaFromDiffuseTexture = true
  barMat.backFaceCulling = false

  barPlane = MeshBuilder.CreatePlane(
    'chargeBarPlane',
    { width: BAR_WIDTH, height: BAR_HEIGHT },
    scene,
  )
  barPlane.position = new Vector3(0, 1.8, 0)
  barPlane.rotation.x = -0.1 // slight tilt toward camera for readability
  barPlane.material = barMat

  // -------------------------------------------------------------------------
  // Additional buildings for context
  // -------------------------------------------------------------------------

  const gridMarkers: Vector3[] = []
  for (let i = -2; i <= 2; i += 2) {
    for (let j = -2; j <= 2; j += 2) {
      if (i === 0 && j === 0) continue
      gridMarkers.push(new Vector3(i + 0.5, 0, j + 0.5))
    }
  }

  return { engine, scene }
}

// ---------------------------------------------------------------------------
// Bar update
// ---------------------------------------------------------------------------

function updateBar(): void {
  if (!dynamicTexture) return

  const ctx = dynamicTexture.getContext() as CanvasRenderingContext2D
  buildBarTexture(ctx, chargeProgress, barColorHex, isBarVisible())
  dynamicTexture.update(false)
}

// ---------------------------------------------------------------------------
// UI Controls
// ---------------------------------------------------------------------------

function setupControls(): void {
  // Charge slider
  const rangeCharge = document.getElementById('range-charge') as HTMLInputElement
  const valCharge = document.getElementById('val-charge')!
  rangeCharge.addEventListener('input', () => {
    chargeProgress = parseInt(rangeCharge.value, 10) / 100
    valCharge.textContent = `${Math.round(chargeProgress * 100)}%`
    updateBar()
    updateStatusPanel()
  })

  // Color picker
  const colorPicker = document.getElementById('color-picker') as HTMLInputElement
  colorPicker.addEventListener('input', () => {
    barColorHex = colorPicker.value
    updateBar()
    updateStatusPanel()
  })

  // Color presets
  const colorPreset = document.getElementById('color-preset') as HTMLSelectElement
  colorPreset.addEventListener('change', () => {
    barColorHex = colorPreset.value
    colorPicker.value = barColorHex
    updateBar()
    updateStatusPanel()
  })

  // Active / Disabled / Paused toggle
  const btnActive = document.getElementById('btn-active')!
  const btnDisabled = document.getElementById('btn-disabled')!
  const btnPaused = document.getElementById('btn-paused')!

  function updateStateButtons(): void {
    btnActive.classList.toggle('active', isActive && !isDisabled && !isPaused)
    btnDisabled.classList.toggle('active', isDisabled)
    btnPaused.classList.toggle('active', isPaused)
  }

  btnActive.addEventListener('click', () => {
    isActive = true
    isDisabled = false
    isPaused = false
    updateStateButtons()
    updateBuildingAppearance()
    updateBar()
    updateStatusPanel()
  })

  btnDisabled.addEventListener('click', () => {
    isActive = false
    isDisabled = true
    isPaused = false
    updateStateButtons()
    updateBuildingAppearance()
    updateBar()
    updateStatusPanel()
  })

  btnPaused.addEventListener('click', () => {
    isActive = false
    isDisabled = false
    isPaused = true
    updateStateButtons()
    updateBuildingAppearance()
    updateBar()
    updateStatusPanel()
  })

  // DisplayWhenEmpty toggle
  const btnShowEmpty = document.getElementById('btn-show-empty')!
  const btnShowAlways = document.getElementById('btn-show-always')!

  function updateEmptyButtons(): void {
    btnShowEmpty.classList.toggle('active', !displayWhenEmpty)
    btnShowAlways.classList.toggle('active', displayWhenEmpty)
  }

  btnShowEmpty.addEventListener('click', () => {
    displayWhenEmpty = false
    updateEmptyButtons()
    updateBar()
  })

  btnShowAlways.addEventListener('click', () => {
    displayWhenEmpty = true
    updateEmptyButtons()
    updateBar()
  })

  // Expose to dev tools
  ;(window as unknown as Record<string, unknown>).__chargeBarTest = {
    setProgress: (p: number) => { chargeProgress = Math.max(0, Math.min(1, p)); rangeCharge.value = String(Math.round(p * 100)); valCharge.textContent = `${Math.round(p * 100)}%`; updateBar(); updateStatusPanel() },
    setColor: (c: string) => { barColorHex = c; colorPicker.value = c; updateBar(); updateStatusPanel() },
    setIsActive: (v: boolean) => { isActive = v; isDisabled = !v; isPaused = false; updateStateButtons(); updateBuildingAppearance(); updateBar(); updateStatusPanel() },
  }
}

// ---------------------------------------------------------------------------
// Status Panel Update
// ---------------------------------------------------------------------------

function updateStatusPanel(): void {
  document.getElementById('st-progress')!.textContent = chargeProgress.toFixed(2)
  document.getElementById('st-remaining')!.textContent =
    `${Math.round((1 - chargeProgress) * TOTAL_TICKS)}`
  document.getElementById('st-visible')!.textContent = isBarVisible() ? '是' : '否'
  document.getElementById('st-color')!.textContent = barColorHex

  const buildingState = isDisabled ? 'Disabled' : isPaused ? 'Paused' : 'Active'
  document.getElementById('st-building')!.textContent = buildingState
}

// ---------------------------------------------------------------------------
// Building appearance update (reflect disabled/paused state)
// ---------------------------------------------------------------------------

function updateBuildingAppearance(): void {
  const scene = engine?.scenes[0]
  if (!scene) return
  const building = scene.getMeshByName('building')
  if (!building) return
  const mat = building.material as StandardMaterial
  if (!mat) return

  if (isDisabled) {
    mat.diffuseColor = new Color3(0.25, 0.15, 0.15) // dark red
  } else if (isPaused) {
    mat.diffuseColor = new Color3(0.4, 0.4, 0.2) // dark yellow
  } else {
    mat.diffuseColor = new Color3(0.4, 0.5, 0.6) // normal blue-grey
  }
}

// ---------------------------------------------------------------------------
// Info Bar Update
// ---------------------------------------------------------------------------

function updateInfoBar(eng: Engine): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  document.getElementById('info-viewport')!.textContent = `${window.innerWidth}x${window.innerHeight}`
  document.getElementById('info-engine')!.textContent = eng.webGLVersion === 2 ? 'WebGL 2.0' : 'WebGL 1.0'
  document.getElementById('info-fps')!.textContent = String(Math.round(eng.getFps()))
  document.getElementById('info-time')!.textContent = new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { engine, scene } = setupScene()
setupControls()
updateStatusPanel()

engine.runRenderLoop(() => {
  scene.render()
  updateInfoBar(engine)
})

window.addEventListener('resize', () => {
  engine.resize()
})
