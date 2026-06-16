/**
 * support-powers/nuke/main.ts — NukePower range circle visual acceptance test
 *
 * Verifies:
 * 1. CircleRanges render as colored circles at correct radii
 * 2. CircleColor / CircleBorderColor match configured colors
 * 3. CircleWidth / CircleBorderWidth are independently configurable
 * 4. Multiple circles can overlap with alpha-blended fill
 *
 * Architecture:
 *   - Babylon.js scene with top-down camera view
 *   - CircleDescriptor[] drives circle rendering via Canvas2D overlay
 *   - Target position set by clicking on terrain
 *   - Color/width controls via UI sliders and color pickers
 *
 * OpenRA comparison:
 *   SelectNukePowerTarget.getRangeCircles(centerPos) returns CircleDescriptor[]
 *   CircleDescriptor = { range: WDist, color: ColorStub, width: number,
 *                        borderColor: ColorStub, borderWidth: number }
 *   Default colors: CircleColor = rgba(255,0,0,128) borderColor = rgba(255,0,0,64)
 *   Default widths: width=1, borderWidth=3
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
  PointerEventTypes,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Circle Descriptor (mirrors NukePower.CircleDescriptor)
// ---------------------------------------------------------------------------

interface CircleDescriptor {
  /** The radius of the circle in WDist (world-distance units, 1 cell = 1024). */
  range: number
  /** The fill color (RGBA). */
  color: { r: number; g: number; b: number; a: number }
  /** The line width (pixels). */
  width: number
  /** The border color (RGBA). */
  borderColor: { r: number; g: number; b: number; a: number }
  /** The border width (pixels). */
  borderWidth: number
}

// ---------------------------------------------------------------------------
// Defaults (matching NUKE_POWER_DEFAULTS)
// ---------------------------------------------------------------------------

const DEFAULT_CIRCLE_COLOR = { r: 255, g: 0, b: 0, a: 128 / 255 }
const DEFAULT_BORDER_COLOR = { r: 255, g: 0, b: 0, a: 64 / 255 }
const DEFAULT_LINE_WIDTH = 1
const DEFAULT_BORDER_WIDTH = 3

// ---------------------------------------------------------------------------
// Preset configurations (match common OpenRA nuke configs)
// ---------------------------------------------------------------------------

interface PresetConfig {
  ranges: number[]
  name: string
}

const presets: Record<string, PresetConfig> = {
  nuke: {
    name: 'Tactical Nuke (3 ranges)',
    ranges: [2048, 4096, 6144], // WDist: 2 cells, 4 cells, 6 cells
  },
  single: {
    name: 'Single Circle',
    ranges: [3072],
  },
  concentric: {
    name: 'Concentric (5 rings)',
    ranges: [1024, 2048, 3072, 4096, 5120],
  },
  custom: {
    name: 'Custom',
    ranges: [2048, 4096, 6144],
  },
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let targetWorldPos: { x: number; y: number; z: number } | null = null
let currentRanges: number[] = [...presets.nuke.ranges]

let circleFillColor = { ...DEFAULT_CIRCLE_COLOR }
let circleBorderColor = { ...DEFAULT_BORDER_COLOR }
let lineWidth = DEFAULT_LINE_WIDTH
let borderWidth = DEFAULT_BORDER_WIDTH

// ---------------------------------------------------------------------------
// Scene constants
// ---------------------------------------------------------------------------

/** World-space size of the terrain grid. */
const GRID_SIZE = 14
/** WDist to world-space conversion: 1 cell = 1 world unit. */
const WDistUnit = 1 / 1024 // 1 WDist = 1/1024 world units
// wdistToWorld kept as reference: wdist * WDistUnit

// ---------------------------------------------------------------------------
// Babylon.js Setup
// ---------------------------------------------------------------------------

let engine!: Engine
let scene!: Scene
let bjsCanvas!: HTMLCanvasElement
let gridSizeWorld = GRID_SIZE // world units

function setupScene(): void {
  bjsCanvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  engine = new Engine(bjsCanvas, true, {
    preserveDrawingBuffer: true,
    stencil: false,
  })
  scene = new Scene(engine)
  scene.clearColor = new Color4(0.12, 0.14, 0.18, 1)

  // Top-down camera
  const camera = new ArcRotateCamera(
    'camera',
    -Math.PI / 2,
    0.01,
    12,
    new Vector3(gridSizeWorld / 2, 0, gridSizeWorld / 2),
    scene,
  )
  camera.attachControl(bjsCanvas, true)
  camera.lowerRadiusLimit = 3
  camera.upperRadiusLimit = 30

  // Lights
  new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)

  // Terrain grid
  const texRes = 512
  const gridTex = new DynamicTexture('gridTex', { width: texRes, height: texRes }, scene, false)
  const gctx = gridTex.getContext() as CanvasRenderingContext2D
  gctx.fillStyle = '#2a3a2a'
  gctx.fillRect(0, 0, texRes, texRes)
  // Draw grid lines at 1-cell intervals
  const cellsPerSide = GRID_SIZE
  const cellPx = texRes / cellsPerSide
  gctx.strokeStyle = '#1d2d1d'
  gctx.lineWidth = 1
  for (let i = 0; i <= cellsPerSide; i++) {
    gctx.beginPath()
    gctx.moveTo(i * cellPx, 0)
    gctx.lineTo(i * cellPx, texRes)
    gctx.stroke()
    gctx.beginPath()
    gctx.moveTo(0, i * cellPx)
    gctx.lineTo(texRes, i * cellPx)
    gctx.stroke()
  }
  // Major grid lines (every 4 cells = 1 "chunk")
  gctx.strokeStyle = '#3a5a3a'
  gctx.lineWidth = 2
  for (let i = 0; i <= cellsPerSide; i += 4) {
    gctx.beginPath()
    gctx.moveTo(i * cellPx, 0)
    gctx.lineTo(i * cellPx, texRes)
    gctx.stroke()
    gctx.beginPath()
    gctx.moveTo(0, i * cellPx)
    gctx.lineTo(texRes, i * cellPx)
    gctx.stroke()
  }
  gridTex.update(false)

  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.diffuseTexture = gridTex
  groundMat.specularColor = new Color3(0, 0, 0)

  const ground = MeshBuilder.CreateGround(
    'ground',
    { width: gridSizeWorld, height: gridSizeWorld },
    scene,
  )
  ground.position.y = -0.01
  ground.material = groundMat
}

// ---------------------------------------------------------------------------
// HTML Canvas Overlay for circle rendering
// ---------------------------------------------------------------------------

let overlayCanvas: HTMLCanvasElement | null = null
let overlayCtx: CanvasRenderingContext2D | null = null

function setupOverlay(): void {
  overlayCanvas = document.createElement('canvas')
  overlayCanvas.id = 'overlayCanvas'
  overlayCanvas.style.position = 'absolute'
  overlayCanvas.style.top = '0'
  overlayCanvas.style.left = '0'
  overlayCanvas.style.width = '100%'
  overlayCanvas.style.height = '100%'
  overlayCanvas.style.pointerEvents = 'none'
  overlayCanvas.width = 0
  overlayCanvas.height = 0
  document.getElementById('sandbox')!.appendChild(overlayCanvas)
  overlayCtx = overlayCanvas.getContext('2d')!

  window.addEventListener('resize', resizeOverlay)
  resizeOverlay()
}

function resizeOverlay(): void {
  if (!overlayCanvas) return
  const rect = bjsCanvas.getBoundingClientRect()
  overlayCanvas.width = rect.width
  overlayCanvas.height = rect.height
  overlayCanvas.style.width = `${rect.width}px`
  overlayCanvas.style.height = `${rect.height}px`
}

// ---------------------------------------------------------------------------
// Coordinate conversion
// ---------------------------------------------------------------------------

/**
 * Convert a world-space position to canvas pixel coordinates.
 */
function worldToCanvas(worldX: number, worldZ: number): { x: number; y: number } | null {
  if (!overlayCanvas) return null
  const rect = bjsCanvas.getBoundingClientRect()
  const sx = (worldX / gridSizeWorld) * rect.width
  const sy = (worldZ / gridSizeWorld) * rect.height
  return { x: sx, y: sy }
}

/**
 * Convert a WDist radius to canvas pixel radius.
 */
function wdistToPixels(wdist: number): number {
  if (!overlayCanvas) return 0
  const rect = bjsCanvas.getBoundingClientRect()
  return (wdist * WDistUnit / gridSizeWorld) * rect.width
}

// ---------------------------------------------------------------------------
// Circle rendering
// ---------------------------------------------------------------------------

function rgbaStr(c: { r: number; g: number; b: number; a: number }): string {
  return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${c.a.toFixed(2)})`
}

function drawCircles(): void {
  if (!overlayCtx || !overlayCanvas || !targetWorldPos) return
  const ctx = overlayCtx
  const w = overlayCanvas.width
  const h = overlayCanvas.height

  // We only want to clear the circle area — not the entire canvas.
  // For simplicity, we clear and redraw. The Babylon.js scene is behind us.
  ctx.clearRect(0, 0, w, h)

  const center = worldToCanvas(targetWorldPos.x, targetWorldPos.z)
  if (!center) return

  // Create descriptors from state (mirrors SelectNukePowerTarget.getRangeCircles)
  const descriptors: CircleDescriptor[] = currentRanges.map((range) => ({
    range,
    color: circleFillColor,
    width: lineWidth,
    borderColor: circleBorderColor,
    borderWidth: borderWidth,
  }))

  for (const desc of descriptors) {
    const radius = wdistToPixels(desc.range)

    // Fill circle
    if (desc.color.a > 0) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = rgbaStr(desc.color)
      ctx.fill()
      ctx.restore()
    }

    // Border circle (on top of fill)
    if (desc.borderColor.a > 0 && desc.borderWidth > 0) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2)
      ctx.strokeStyle = rgbaStr(desc.borderColor)
      ctx.lineWidth = desc.borderWidth
      ctx.stroke()
      ctx.restore()
    }

    // Inner line circle (the thin "width" line, on top of border)
    if (desc.width > 0 && desc.width !== desc.borderWidth) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2)
      ctx.strokeStyle = rgbaStr(desc.color)
      ctx.lineWidth = desc.width
      ctx.stroke()
      ctx.restore()
    }
  }

  // Draw center crosshair
  ctx.save()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(center.x - 8, center.y)
  ctx.lineTo(center.x + 8, center.y)
  ctx.moveTo(center.x, center.y - 8)
  ctx.lineTo(center.x, center.y + 8)
  ctx.stroke()
  ctx.restore()

  // Draw range labels
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.font = '11px monospace'
  ctx.textAlign = 'center'
  for (const desc of descriptors) {
    const r = wdistToPixels(desc.range)
    const labelY = center.y - r - 4
    if (labelY > 10) {
      ctx.fillText(`r=${desc.range}`, center.x, labelY)
    }
  }
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Mouse interaction
// ---------------------------------------------------------------------------

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return

  const rect = bjsCanvas.getBoundingClientRect()
  const px = e.clientX - rect.left
  const py = e.clientY - rect.top

  const worldX = (px / rect.width) * gridSizeWorld
  const worldZ = (py / rect.height) * gridSizeWorld

  targetWorldPos = { x: worldX, y: 0, z: worldZ }
  updateTargetInfo()
  drawCircles()
}

function onPointerMove(_e: PointerEvent): void {
  // Could show preview circles at cursor position, but keeping it simple.
}

// ---------------------------------------------------------------------------
// UI Controls
// ---------------------------------------------------------------------------

function setupControls(): void {
  // Preset selector
  const selPreset = document.getElementById('sel-preset') as HTMLSelectElement
  selPreset.addEventListener('change', () => {
    const key = selPreset.value
    const preset = presets[key]
    if (!preset) return

    if (key !== 'custom') {
      currentRanges = [...preset.ranges]
      // Update custom input fields to match
      updateCustomInputs(currentRanges)
    }
    updateTargetInfo()
    drawCircles()
  })

  // Color fill
  const colorFill = document.getElementById('color-fill') as HTMLInputElement
  const rangeFillA = document.getElementById('range-fill-a') as HTMLInputElement
  const valFillA = document.getElementById('val-fill-a')!

  function updateFillColor(): void {
    const hex = colorFill.value
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    const a = parseInt(rangeFillA.value, 10) / 255
    circleFillColor = { r, g, b, a }

    valFillA.textContent = String(parseInt(rangeFillA.value, 10))
    updateTargetInfo()
    drawCircles()
  }

  colorFill.addEventListener('input', updateFillColor)
  rangeFillA.addEventListener('input', updateFillColor)

  // Color border
  const colorBorder = document.getElementById('color-border') as HTMLInputElement
  colorBorder.addEventListener('input', () => {
    const hex = colorBorder.value
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    circleBorderColor = { ...circleBorderColor, r, g, b }
    updateTargetInfo()
    drawCircles()
  })

  // Border width
  const rangeBorderW = document.getElementById('range-border-w') as HTMLInputElement
  const valBorderW = document.getElementById('val-border-w')!
  rangeBorderW.addEventListener('input', () => {
    borderWidth = parseInt(rangeBorderW.value, 10)
    valBorderW.textContent = String(borderWidth)
    updateTargetInfo()
    drawCircles()
  })

  // Line width
  const rangeLineW = document.getElementById('range-line-w') as HTMLInputElement
  const valLineW = document.getElementById('val-line-w')!
  rangeLineW.addEventListener('input', () => {
    lineWidth = parseInt(rangeLineW.value, 10)
    valLineW.textContent = String(lineWidth)
    updateTargetInfo()
    drawCircles()
  })

  // Custom range inputs
  for (let i = 1; i <= 3; i++) {
    const input = document.getElementById(`cfg-r${i}`) as HTMLInputElement
    const label = document.getElementById(`cfg-label-r${i}`)!
    input.addEventListener('input', () => {
      const val = parseInt(input.value, 10) || 0
      label.textContent = `${(val / 1024).toFixed(1)} cells`
    })
  }

  // Apply custom button
  document.getElementById('btn-apply-custom')!.addEventListener('click', () => {
    const r1 = parseInt((document.getElementById('cfg-r1') as HTMLInputElement).value, 10) || 0
    const r2 = parseInt((document.getElementById('cfg-r2') as HTMLInputElement).value, 10) || 0
    const r3 = parseInt((document.getElementById('cfg-r3') as HTMLInputElement).value, 10) || 0
    currentRanges = [r1, r2, r3].filter((r) => r > 0)
    selPreset.value = 'custom'
    updateTargetInfo()
    drawCircles()
  })

  // Clear target
  document.getElementById('btn-clear-target')!.addEventListener('click', () => {
    targetWorldPos = null
    updateTargetInfo()
    if (overlayCtx && overlayCanvas) {
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height)
    }
  })

  // Initialize
  updateCustomInputs(currentRanges)
}

function updateCustomInputs(ranges: number[]): void {
  for (let i = 1; i <= 3; i++) {
    const input = document.getElementById(`cfg-r${i}`) as HTMLInputElement
    const label = document.getElementById(`cfg-label-r${i}`)!
    const val = ranges[i - 1] ?? 0
    input.value = String(val)
    label.textContent = `${(val / 1024).toFixed(1)} cells`
  }
}

// ---------------------------------------------------------------------------
// Status Panel Update
// ---------------------------------------------------------------------------

function updateTargetInfo(): void {
  document.getElementById('st-target')!.textContent = targetWorldPos
    ? `(${targetWorldPos.x.toFixed(2)}, ${targetWorldPos.z.toFixed(2)})`
    : '无'
  document.getElementById('st-ranges')!.textContent =
    currentRanges.length > 0 ? currentRanges.join(', ') : '-'

  document.getElementById('st-fill')!.textContent =
    `rgba(${circleFillColor.r},${circleFillColor.g},${circleFillColor.b},${circleFillColor.a.toFixed(2)})`
  const swatchFill = document.getElementById('swatch-fill')!
  swatchFill.style.background = `rgba(${circleFillColor.r},${circleFillColor.g},${circleFillColor.b},${circleFillColor.a.toFixed(2)})`

  document.getElementById('st-border')!.textContent =
    `rgba(${circleBorderColor.r},${circleBorderColor.g},${circleBorderColor.b},${circleBorderColor.a.toFixed(2)})`
  const swatchBorder = document.getElementById('swatch-border')!
  swatchBorder.style.background = `rgba(${circleBorderColor.r},${circleBorderColor.g},${circleBorderColor.b},${circleBorderColor.a.toFixed(2)})`
}

// ---------------------------------------------------------------------------
// Info Bar
// ---------------------------------------------------------------------------

function updateInfoBar(): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  document.getElementById('info-viewport')!.textContent = `${window.innerWidth}x${window.innerHeight}`
  document.getElementById('info-engine')!.textContent = engine.webGLVersion === 2 ? 'WebGL 2.0' : 'WebGL 1.0'
  document.getElementById('info-fps')!.textContent = String(Math.round(engine.getFps()))
  document.getElementById('info-time')!.textContent = new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Pointer events
// ---------------------------------------------------------------------------

function setupInteraction(): void {
  bjsCanvas.addEventListener('pointerdown', onPointerDown)
  bjsCanvas.addEventListener('pointermove', onPointerMove)
  bjsCanvas.addEventListener('contextmenu', (e) => e.preventDefault())

  // Click to set target via Babylon.js pointer observable
  scene.onPointerObservable.add((pointerInfo) => {
    const e = pointerInfo.event as PointerEvent
    if (e.button !== 0) return
    // Already handled by direct pointerdown above
  }, PointerEventTypes.POINTERDOWN)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

setupScene()
setupOverlay()
setupControls()
setupInteraction()
updateTargetInfo()
updateInfoBar()

engine.runRenderLoop(() => {
  scene.render()
  updateInfoBar()
})

window.addEventListener('resize', () => {
  engine.resize()
  resizeOverlay()
  drawCircles()
})

// Expose for dev tools
;(window as unknown as Record<string, unknown>).__nukeTest = {
  targetWorldPos,
  currentRanges,
  circleFillColor,
  circleBorderColor,
  lineWidth,
  borderWidth,
  worldToCanvas,
  wdistToPixels,
  setTarget: (x: number, z: number) => { targetWorldPos = { x, y: 0, z }; updateTargetInfo(); drawCircles() },
  clearTarget: () => { targetWorldPos = null; updateTargetInfo(); if (overlayCtx && overlayCanvas) overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height) },
  draw: drawCircles,
}
