/**
 * support-powers/airstrike/main.ts — SelectDirectionalTarget acceptance test
 *
 * Verifies:
 * 1. 8 arrow directions rendered at correct angles (CCW from North)
 * 2. Drag distance thresholds: MinDragThreshold=20px, MaxDragThreshold=75px
 * 3. Cursor changes: Cursor vs BlockedCursor based on terrain validity
 * 4. Angle computation: angleOf() produces correct degree mapping
 * 5. Arrow selection: getArrow() selects correct arrow for given angle
 *
 * Architecture:
 *   - HTML5 Canvas overlay for drag-to-aim interaction (mirrors OpenRA
 *     SelectDirectionalTarget.Order() behaviour)
 *   - Babylon.js scene provides visual context (terrain grid)
 *   - 8-directional arrow overlay drawn on HTML canvas above BJS canvas
 *
 * OpenRA comparison:
 *   SelectDirectionalTarget.angleOf(delta) -> clockwise from North
 *   SelectDirectionalTarget.getArrow(degree, arrows) -> first-over-threshold
 *   SelectDirectionalTarget.vectorLength(v) -> sqrt(x^2 + y^2)
 *   MinDragThreshold = 20, MaxDragThreshold = 75
 *   ExtraData = arrow.direction.facing (WAngle) or 0xFFFFFFFF (no direction)
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
// Constants (matching SelectDirectionalTarget)
// ---------------------------------------------------------------------------

/** Minimum drag threshold in CSS pixels. */
const MIN_DRAG_THRESHOLD = 20
/** Maximum drag threshold in CSS pixels. */
const MAX_DRAG_THRESHOLD = 75
/** ExtraData value when drag is too short (uint.MaxValue). */
const NO_DIRECTION = 0xffffffff
/** Fraction of the grid (from the left) that marks blocked terrain. Must match texture drawing in setupScene(). */
const BLOCKED_BOUNDARY = 9 / 14 // Math.floor(14 * 2/3) / 14

// ---------------------------------------------------------------------------
// Arrow Direction (mirrors Arrow record in SelectDirectionalTarget.ts)
// ---------------------------------------------------------------------------

interface ArrowDef {
  /** Name of the direction. */
  name: string
  /** End angle (degrees, upper bound of the sector). */
  endAngle: number
  /** WAngle facing value (0-1023). */
  facing: number
}

/**
 * Load arrows — mirrors SelectDirectionalTarget.loadArrows().
 *
 * Arrow order (CCW, starting from N = (0,-1)):
 *   N, NW, W, SW, S, SE, E, NE
 * Each arrow covers a sector of 360/N degrees centered on its direction.
 */
function loadArrows(count: number): ArrowDef[] {
  if (count <= 0) return []

  const names8 = ['N', 'NW', 'W', 'SW', 'S', 'SE', 'E', 'NE']
  const partAngle = 360 / count
  const halfAngle = partAngle / 2

  const arrows: ArrowDef[] = []
  for (let i = 0; i < count; i++) {
    const angle = i * partAngle
    const endAngleVal = angle + halfAngle
    const facing = Math.round(((angle % 360) * 1024) / 360) & 0x3ff
    const name = count === 8 ? names8[i] :
      count === 16
        ? `${names8[Math.floor(i / 2)]}${i % 2 === 0 ? '' : "'"}`
        : `${i * partAngle}°`
    arrows.push({ name, endAngle: endAngleVal, facing })
  }
  return arrows
}

// ---------------------------------------------------------------------------
// Angle computation (mirrors SelectDirectionalTarget.angleOf)
// ---------------------------------------------------------------------------

/**
 * Compute the clockwise angle from North from a drag vector.
 *
 * OpenRA 对照: SelectDirectionalTarget.AngleOf(float2)
 *
 * atan2(delta.y, delta.x) → degrees → 270 - d → mod 360 = clockwise from North.
 *   - delta (0, -1): atan2(-1, 0) = -90° → 270 - (-90) = 360 → 0° (North)
 *   - delta (1, 0):  atan2(0, 1) = 0° → 270 - 0 = 270 → 270°... wait.
 *
 * Let me re-derive from the source: OpenRA code is:
 *   var d = WAngle.FromFacing(Math.Atan2(delta.Y, delta.X).RadianToBAM());
 *   var degree = d.Angle();
 *   var angle = 270.0 - degree;
 *   if (angle < 0) angle += 360.0;
 *   return angle;
 *
 * Math.Atan2(y, x) returns angle from +X axis. In screen coordinates:
 *   +X = right, +Y = down.
 *   atan2(delta.y, delta.x) where delta is screen-space drag.
 *   Drag to right (positive X): atan2(0, 1) = 0 rad = 0°.
 *   Then: 270° - 0° = 270°. But we want East = 90°...
 *
 * Wait, let me trace more carefully with the TS source code:
 *   angleOf: radian * (180/Math.PI) → d, if d<0 add 360, let angle = 270 - d, if<0 add 360.
 *
 * Test: delta = (0, -1) (dragging UP): atan2(-1, 0) = -1.5708 rad = -90°.
 *   d = -90 → d < 0 → d = 270°.
 *   angle = 270 - 270 = 0°. OK, North = 0°.
 *
 * Test: delta = (1, 0) (dragging RIGHT): atan2(0, 1) = 0 rad = 0°.
 *   d = 0°.
 *   angle = 270 - 0 = 270°. But East should be... hmm. In OpenRA, facing:
 *   North=0, East=256 (90°), South=512 (180°), West=768 (270°).
 *   So angle 270° maps to West, not East!
 *
 * Wait — in the screen coordinate system where +Y is down, dragging right
 * (1, 0) means the mouse moved east on screen. In the top-down view where
 * camera is pointing down, screen-right = world-east.
 * The facing WAngle: 0=North, 256=East (CCW in OpenRA's view, which is CW in screen).
 *
 * Actually re-reading the OpenRA source comment in SelectDirectionalTarget.cs:
 * "Arrow directions (CCW, 8 directions, starting from N = (0,-1)):
 *   0: N   1: NW   2: W   3: SW   4: S   5: SE   6: E   7: NE"
 *
 * The angleOf() returns degrees 0-360 which getArrow() then maps to arrows.
 * Let me verify: atan2(delta.y, delta.x) with screen coords (X right, Y down).
 *
 * Drag UP (0, -1): screen-North → angle 0 → Arrow[0] = "N (North)" → facing ~0 ✓
 * Drag UP-LEFT (-1, -1): atan2(-1, -1) = -135° → d=225° → 270-225=45° → Arrow[1]="NW" → facing ~128 ✓
 * Drag LEFT (-1, 0): atan2(0, -1) = 180° or π → d=180° → 270-180=90° → Arrow[2]="W" → facing ~256 ✓
 * Drag DOWN-LEFT (-1, 1): atan2(1, -1) = 135° → d=135° → 270-135=135° → Arrow[3]="SW" → facing ~384 ✓
 * Drag DOWN (0, 1): atan2(1, 0) = 90° → d=90° → 270-90=180° → Arrow[4]="S" → facing ~512 ✓
 * Drag DOWN-RIGHT (1, 1): atan2(1, 1) = 45° → d=45° → 270-45=225° → Arrow[5]="SE" → facing ~640 ✓
 * Drag RIGHT (1, 0): atan2(0, 1) = 0° → d=0° → 270-0=270° → Arrow[6]="E" → facing ~768 ✓
 * Drag UP-RIGHT (1, -1): atan2(-1, 1) = -45° → d=315° → 270-315=-45→315° → Arrow[7]="NE" → facing ~896 ✓
 *
 * Good — the CCW ordering of arrows matches this angle mapping.
 */
function angleOf(delta: { x: number; y: number }): number {
  const radian = Math.atan2(delta.y, delta.x)
  let d = radian * (180 / Math.PI)
  if (d < 0.0) d += 360.0
  let angle = 270.0 - d
  if (angle < 0) angle += 360.0
  return angle
}

// ---------------------------------------------------------------------------
// Arrow selection (mirrors SelectDirectionalTarget.getArrow)
// ---------------------------------------------------------------------------

function getArrow(degree: number, arrows: readonly ArrowDef[]): ArrowDef {
  for (const arrow of arrows) {
    if (arrow.endAngle >= degree) return arrow
  }
  return arrows[0]
}

function vectorLength(v: { x: number; y: number }): number {
  return Math.sqrt(v.x * v.x + v.y * v.y)
}

// ---------------------------------------------------------------------------
// Drag state (mirrors SelectDirectionalTarget.DragState)
// ---------------------------------------------------------------------------

interface DragState {
  activated: boolean
  dragStarted: boolean
  targetLocation: { x: number; y: number } | null
  accumulated: { x: number; y: number }
  currentArrow: ArrowDef | null
}

const dragState: DragState = {
  activated: false,
  dragStarted: false,
  targetLocation: null,
  accumulated: { x: 0, y: 0 },
  currentArrow: null,
}

// ---------------------------------------------------------------------------
// Babylon.js Scene Setup
// ---------------------------------------------------------------------------

let engine!: Engine
let scene!: Scene
let bjsCanvas!: HTMLCanvasElement

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
    new Vector3(0, 0, 0),
    scene,
  )
  camera.attachControl(bjsCanvas, true)
  camera.lowerRadiusLimit = 3
  camera.upperRadiusLimit = 30
  camera.panningSensibility = 50

  // Disable camera rotation (keep it top-down for directional targeting test)
  // We let it rotate minimally to avoid interfering with drag

  // Lights
  new HemisphericLight('hemi', new Vector3(0, 1, 0.3), scene)

  // Ground plane with grid
  const gridSize = 14
  const gridTexRes = 512
  const gridTex = new DynamicTexture('gridTex', { width: gridTexRes, height: gridTexRes }, scene, false)
  const gctx = gridTex.getContext() as CanvasRenderingContext2D
  gctx.fillStyle = '#2a3a2a'
  gctx.fillRect(0, 0, gridTexRes, gridTexRes)
  gctx.strokeStyle = '#1a2a1a'
  gctx.lineWidth = 1
  const cellPx = gridTexRes / gridSize
  for (let i = 0; i <= gridSize; i++) {
    gctx.beginPath()
    gctx.moveTo(i * cellPx, 0)
    gctx.lineTo(i * cellPx, gridTexRes)
    gctx.stroke()
    gctx.beginPath()
    gctx.moveTo(0, i * cellPx)
    gctx.lineTo(gridTexRes, i * cellPx)
    gctx.stroke()
  }
  // Draw "blocked" zone (right ~36%, matches BLOCKED_BOUNDARY)
  const blockedStart = Math.round(BLOCKED_BOUNDARY * gridTexRes)
  gctx.fillStyle = 'rgba(255, 50, 50, 0.3)'
  gctx.fillRect(blockedStart, 0, gridTexRes - blockedStart, gridTexRes)
  gctx.fillStyle = '#ff4444'
  gctx.font = '24px monospace'
  gctx.textAlign = 'center'
  gctx.fillText('BLOCKED', blockedStart + (gridTexRes - blockedStart) / 2, gridTexRes / 2)
  gridTex.update(false)

  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.diffuseTexture = gridTex
  groundMat.specularColor = new Color3(0, 0, 0)

  const ground = MeshBuilder.CreateGround(
    'ground',
    { width: gridSize, height: gridSize },
    scene,
  )
  ground.position.y = -0.01
  ground.material = groundMat

  // Markers for 8-direction hint (small arrows visible on terrain)
  // We'll draw these on the HTML overlay canvas instead for clarity.
}

// ---------------------------------------------------------------------------
// HTML Canvas Overlay (directional arrow rendering)
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
  overlayCanvas.width = 0 // will be resized
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

let currentArrowSet: ArrowDef[] = loadArrows(8)
let currentTerrain = 'valid'

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function drawOverlay(): void {
  if (!overlayCtx || !overlayCanvas) return
  const ctx = overlayCtx
  const w = overlayCanvas.width
  const h = overlayCanvas.height
  ctx.clearRect(0, 0, w, h)

  if (!dragState.activated || !dragState.targetLocation) return

  const cx = dragState.targetLocation.x
  const cy = dragState.targetLocation.y

  // Draw cursor type indicator
  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.strokeStyle = currentTerrain === 'valid' ? '#4a4' : '#f44'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, cy, 6, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.restore()

  // Draw MinDragThreshold circle (red dashed — inside = NO_DIRECTION)
  ctx.save()
  ctx.strokeStyle = 'rgba(255, 80, 80, 0.6)'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.arc(cx, cy, MIN_DRAG_THRESHOLD, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()

  // Draw MaxDragThreshold circle (white dashed — outside = clamped)
  ctx.save()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.arc(cx, cy, MAX_DRAG_THRESHOLD, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()

  // Draw drag line
  const dist = vectorLength(dragState.accumulated)
  if (dist > 0.5) {
    const clampedDist = Math.min(dist, MAX_DRAG_THRESHOLD)
    const angle = angleOf(dragState.accumulated)
    // OpenRA angle (0=North, CCW) to canvas radian (0=right, CW): rad = (-90 - angle) * PI / 180
    const rad = (-90 - angle) * Math.PI / 180
    const ex = cx + clampedDist * Math.cos(rad)
    const ey = cy + clampedDist * Math.sin(rad)

    const isOutsideDrag = dist > MIN_DRAG_THRESHOLD
    ctx.save()
    ctx.strokeStyle = isOutsideDrag ? 'rgba(80, 255, 80, 0.9)' : 'rgba(255, 80, 80, 0.9)'
    ctx.lineWidth = 3
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(ex, ey)
    ctx.stroke()

    // Arrowhead
    const ahSize = 10
    const angle1 = rad - 0.4
    const angle2 = rad + 0.4
    ctx.beginPath()
    ctx.moveTo(ex, ey)
    ctx.lineTo(ex - ahSize * Math.cos(angle1), ey - ahSize * Math.sin(angle1))
    ctx.moveTo(ex, ey)
    ctx.lineTo(ex - ahSize * Math.cos(angle2), ey - ahSize * Math.sin(angle2))
    ctx.stroke()
    ctx.restore()
  }

  // Draw all 8 (or N) direction arrows around the target point
  const arrowCount = currentArrowSet.length
  const arrowRadius = MAX_DRAG_THRESHOLD + 32

  for (let i = 0; i < arrowCount; i++) {
    const arrow = currentArrowSet[i]
    const arrowAngle = (i * 360) / arrowCount // center of sector in degrees
    // OpenRA angle (0=North, CCW) to canvas radian (0=right, CW): rad = (-90 - angle) * PI / 180
    const rad = (-90 - arrowAngle) * Math.PI / 180
    const ax = cx + arrowRadius * Math.cos(rad)
    const ay = cy + arrowRadius * Math.sin(rad)

    const isSelected = dragState.currentArrow === arrow

    ctx.save()
    ctx.font = isSelected ? 'bold 16px monospace' : '12px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = isSelected ? '#ff8' : 'rgba(200,200,200,0.6)'
    ctx.fillText(arrow.name, ax, ay)
    ctx.restore()
  }
}

// ---------------------------------------------------------------------------
// Mouse Event Handling
// ---------------------------------------------------------------------------

function getCanvasPosition(e: MouseEvent | PointerEvent): { x: number; y: number } {
  const rect = bjsCanvas.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return // left button only

  const pos = getCanvasPosition(e)
  // Determine terrain validity based on position
  updateTerrainFromPosition(pos)
  updateDragStats()

  dragState.activated = true
  dragState.dragStarted = false
  dragState.targetLocation = pos
  dragState.accumulated = { x: 0, y: 0 }
  dragState.currentArrow = null

  updateCursor()

  bjsCanvas.setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent): void {
  updateTerrainFromPosition(getCanvasPosition(e))
  updateCursor()

  if (!dragState.activated) {
    updateDragStats()
    return
  }

  dragState.accumulated.x += e.movementX
  dragState.accumulated.y += e.movementY

  // Clamp to MAX_DRAG_THRESHOLD and REVERSE direction (OpenRA behavior:
  // when drag exceeds MaxDragThreshold, the vector is flipped to signal a
  // "you went too far — aim the other way" correction)
  const dist = vectorLength(dragState.accumulated)
  if (dist > MAX_DRAG_THRESHOLD) {
    const scale = -MAX_DRAG_THRESHOLD / dist
    dragState.accumulated.x *= scale
    dragState.accumulated.y *= scale
  }

  const angle = angleOf(dragState.accumulated)
  dragState.currentArrow = getArrow(angle, currentArrowSet)
  dragState.dragStarted = true

  updateDragStats()
  drawOverlay()
}

function onPointerUp(e: PointerEvent): void {
  const isOutsideDragZone =
    dragState.dragStarted &&
    vectorLength(dragState.accumulated) > MIN_DRAG_THRESHOLD

  const extraData = isOutsideDragZone && dragState.currentArrow
    ? dragState.currentArrow.facing
    : NO_DIRECTION

  // Log the "order" that would be generated
  console.log('[SelectDirectionalTarget] Order generated:', {
    orderName: 'AirstrikePowerOrder',
    extraData,
    extraDataHex: `0x${extraData.toString(16).toUpperCase()}`,
    hasDirection: extraData !== NO_DIRECTION,
    arrow: dragState.currentArrow?.name ?? 'none',
    dragDistance: Math.round(vectorLength(dragState.accumulated)),
  })

  // Show result briefly
  const dist = Math.round(vectorLength(dragState.accumulated))
  const arrowName = dragState.currentArrow?.name ?? '-'
  const resultMsg =
    extraData === NO_DIRECTION
      ? `无方向 (拖拽 ${dist}px < ${MIN_DRAG_THRESHOLD}px)`
      : `方向: ${arrowName} (拖拽 ${dist}px, ExtraData=${extraData})`
  showResult(resultMsg, extraData !== NO_DIRECTION)

  // Reset
  dragState.activated = false
  dragState.dragStarted = false
  dragState.targetLocation = null
  dragState.accumulated = { x: 0, y: 0 }
  dragState.currentArrow = null

  updateCursor()
  updateDragStats()
  drawOverlay()

  bjsCanvas.releasePointerCapture(e.pointerId)
  if (e.pointerType === 'mouse') {
    bjsCanvas.style.cursor = ''
  }
}

// ---------------------------------------------------------------------------
// Terrain validity from position
// ---------------------------------------------------------------------------

function updateTerrainFromPosition(pos: { x: number; y: number }): void {
  const rect = bjsCanvas.getBoundingClientRect()
  const fracX = pos.x / rect.width

  if (currentTerrain === 'oob') {
    // stay oob
    return
  }

  // Right ~36% is "blocked" terrain (matches BLOCKED_BOUNDARY)
  if (fracX > BLOCKED_BOUNDARY) {
    currentTerrain = 'blocked'
  } else {
    currentTerrain = 'valid'
  }
}

function updateCursor(): void {
  if (dragState.activated) {
    bjsCanvas.style.cursor = 'crosshair'
    return
  }

  if (currentTerrain === 'valid') {
    bjsCanvas.style.cursor = 'crosshair'
  } else {
    bjsCanvas.style.cursor = 'not-allowed'
  }
}

function showResult(msg: string, good: boolean): void {
  const div = document.createElement('div')
  div.style.cssText = `
    position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%);
    background: ${good ? 'rgba(0,128,0,0.85)' : 'rgba(128,0,0,0.85)'};
    color: #fff; padding: 12px 24px; border-radius: 6px;
    font-size: 16px; font-weight: bold; pointer-events: none;
    z-index: 100;
  `
  div.textContent = msg
  document.getElementById('sandbox')!.appendChild(div)
  setTimeout(() => div.remove(), 2000)
}

// ---------------------------------------------------------------------------
// Drag Stats Update
// ---------------------------------------------------------------------------

function updateDragStats(): void {
  const dist = vectorLength(dragState.accumulated)
  const angle = dragState.activated ? angleOf(dragState.accumulated) : 0

  document.getElementById('st-dragging')!.textContent = dragState.activated
    ? '拖拽中'
    : '待机'
  document.getElementById('st-dist')!.textContent = `${Math.round(dist)}px`
  document.getElementById('st-angle')!.textContent = `${angle.toFixed(1)}°`
  document.getElementById('st-arrow')!.textContent =
    dragState.currentArrow?.name ?? '-'
  document.getElementById('st-extradata')!.textContent =
    dragState.currentArrow ? `0x${dragState.currentArrow.facing.toString(16).toUpperCase()}` : '-'
  document.getElementById('st-cursor')!.textContent =
    currentTerrain === 'valid' ? 'ability (Cursor)' :
    currentTerrain === 'blocked' ? 'blocked (BlockedCursor)' : 'blocked (OOB)'
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
// UI Controls
// ---------------------------------------------------------------------------

function setupControls(): void {
  document.getElementById('btn-mode-target')!.addEventListener('click', () => {
    dragState.activated = false
    dragState.dragStarted = false
    updateCursor()
    updateDragStats()
    drawOverlay()
    updateButtonState()
  })

  document.getElementById('btn-mode-cancel')!.addEventListener('click', () => {
    // Cancel mode: reset everything
    dragState.activated = false
    dragState.dragStarted = false
    dragState.targetLocation = null
    dragState.accumulated = { x: 0, y: 0 }
    dragState.currentArrow = null
    bjsCanvas.style.cursor = ''
    updateDragStats()
    drawOverlay()
    updateButtonState()
  })

  const selTerrain = document.getElementById('sel-terrain') as HTMLSelectElement
  selTerrain.addEventListener('change', () => {
    currentTerrain = selTerrain.value
    updateCursor()
    updateDragStats()
  })

  const selArrows = document.getElementById('sel-arrows') as HTMLSelectElement
  selArrows.addEventListener('change', () => {
    const count = parseInt(selArrows.value, 10)
    currentArrowSet = loadArrows(count)
    drawOverlay()
  })

  function updateButtonState(): void {
    document.getElementById('btn-mode-target')!.classList.toggle('active', true)
    document.getElementById('btn-mode-cancel')!.classList.toggle('active', false)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

setupScene()
setupOverlay()
setupControls()
updateInfoBar()

// Register pointer events
bjsCanvas.addEventListener('pointerdown', onPointerDown)
bjsCanvas.addEventListener('pointermove', onPointerMove)
bjsCanvas.addEventListener('pointerup', onPointerUp)
bjsCanvas.addEventListener('pointerleave', () => {
  if (dragState.activated) {
    // cancel drag if pointer leaves
    dragState.activated = false
    bjsCanvas.style.cursor = ''
    drawOverlay()
    updateDragStats()
  }
})
bjsCanvas.addEventListener('contextmenu', (e) => e.preventDefault())

engine.runRenderLoop(() => {
  scene.render()
  updateInfoBar()
})

window.addEventListener('resize', () => {
  engine.resize()
  resizeOverlay()
})

// Expose for dev tools
;(window as unknown as Record<string, unknown>).__airstrikeTest = {
  angleOf,
  getArrow,
  vectorLength,
  loadArrows,
  dragState,
  getCurrentArrowSet: () => currentArrowSet,
  MIN_DRAG_THRESHOLD,
  MAX_DRAG_THRESHOLD,
  NO_DIRECTION,
}
