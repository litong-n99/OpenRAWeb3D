/**
 * widgets/radar/main.ts — RadarWidget Canvas minimap acceptance test
 *
 * Renders a mocked minimap with terrain colors, actor positions,
 * shroud overlay, and an interactive viewport rectangle.
 * Verifies coordinate output on click.
 *
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/RadarWidget.cs (530 lines)
 */

// ---------------------------------------------------------------------------
// Info bar
// ---------------------------------------------------------------------------

function updateInfoBar(): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  document.getElementById('info-viewport')!.textContent = `${window.innerWidth}x${window.innerHeight}`
  document.getElementById('info-fps')!.textContent = '-'
  document.getElementById('info-time')!.textContent = new Date().toISOString()
}
updateInfoBar()
setInterval(updateInfoBar, 1000)

// ---------------------------------------------------------------------------
// Test map configuration
// ---------------------------------------------------------------------------

const MAP_CELLS_W = 64  // map width in cells
const MAP_CELLS_H = 48  // map height in cells
const RADAR_SCALE = 4   // pixels per cell on the minimap
const RADAR_W = MAP_CELLS_W * RADAR_SCALE
const RADAR_H = MAP_CELLS_H * RADAR_SCALE

// Terrain types
const TERRAIN_COLORS: Record<string, [number, number, number, number]> = {
  Clear:  [74, 124, 63,  255],  // #4a7c3f
  Rough:  [139, 115, 85, 255],  // #8b7355
  Water:  [74, 109, 140, 255],  // #4a6d8c
  Road:   [160, 136, 74, 255],  // #a0884a
  Ore:    [85, 85, 85,   255],  // #555555
  Beach:  [180, 170, 140, 255], // #b4aa8c
  Cliff:  [100, 60, 40,  255],  // #643c28
}

type TerrainType = keyof typeof TERRAIN_COLORS

// ---------------------------------------------------------------------------
// Generate mock terrain grid
// ---------------------------------------------------------------------------

const terrainGrid: TerrainType[] = new Array(MAP_CELLS_W * MAP_CELLS_H)

function generateTerrain(): void {
  // Simple seeded noise: use deterministic pattern for reproducibility
  for (let y = 0; y < MAP_CELLS_H; y++) {
    for (let x = 0; x < MAP_CELLS_W; x++) {
      const idx = y * MAP_CELLS_W + x
      // Middle of map: water river
      if (y >= 22 && y <= 26 && x > 5 && x < MAP_CELLS_W - 5) {
        terrainGrid[idx] = 'Water'
      }
      // Road paths
      else if (
        (y === 10 || y === 38) && x % 10 < 8 ||
        (x === 15 || x === 48) && y % 10 < 8
      ) {
        terrainGrid[idx] = 'Road'
      }
      // Ore patches
      else if (
        (x > 25 && x < 35 && y > 8 && y < 14) ||
        (x > 40 && x < 50 && y > 35 && y < 42)
      ) {
        terrainGrid[idx] = 'Ore'
      }
      // Cliffs
      else if (y === 20 && x > 10 && x < 55) {
        terrainGrid[idx] = 'Cliff'
      }
      // Beaches near water
      else if (
        (y === 21 || y === 27) && x > 5 && x < MAP_CELLS_W - 5
      ) {
        terrainGrid[idx] = 'Beach'
      }
      // Mix of Clear and Rough
      else {
        const hash = ((x * 374761393 + y * 668265263) & 0x7FFFFFFF) % 10
        terrainGrid[idx] = hash < 7 ? 'Clear' : 'Rough'
      }
    }
  }
}
generateTerrain()

// ---------------------------------------------------------------------------
// Mock actor positions (unit dots on the minimap)
// ---------------------------------------------------------------------------

interface MockActor {
  x: number   // cell X
  y: number   // cell Y
  ownerId: number
  color: [number, number, number]  // RGB
  size: number  // dot radius in radar pixels
}

const mockActors: MockActor[] = [
  { x: 10, y: 10, ownerId: 1, color: [200, 200, 50], size: 2 },   // player harvester
  { x: 12, y: 12, ownerId: 1, color: [50, 200, 50], size: 1.5 },  // player infantry
  { x: 14, y: 8,  ownerId: 1, color: [50, 200, 50], size: 1.5 },  // player infantry
  { x: 16, y: 10, ownerId: 1, color: [50, 100, 200], size: 2 },   // player vehicle
  { x: 50, y: 10, ownerId: 1, color: [200, 200, 50], size: 2 },   // player harvester
  { x: 45, y: 40, ownerId: 2, color: [200, 50, 50], size: 2 },    // enemy vehicle
  { x: 48, y: 38, ownerId: 2, color: [200, 50, 50], size: 1.5 },  // enemy infantry
  { x: 46, y: 42, ownerId: 2, color: [200, 50, 50], size: 1.5 },  // enemy infantry
  { x: 30, y: 30, ownerId: 1, color: [100, 200, 200], size: 3 },  // player structure
  { x: 20, y: 42, ownerId: 3, color: [200, 200, 50], size: 2 },   // neutral
]

// ---------------------------------------------------------------------------
// Shroud / visibility grid (per-cell visibility flags)
// ---------------------------------------------------------------------------

const VIS_NONE = 0     // unexplored (black)
const VIS_FOG = 1      // explored but not visible (semi-transparent black)
const VIS_VISIBLE = 2  // currently visible (no overlay)

const visibilityGrid: number[] = new Array(MAP_CELLS_W * MAP_CELLS_H).fill(VIS_NONE)

function initVisibility(): void {
  // Player can see a circular area around the middle-left
  for (let y = 0; y < MAP_CELLS_H; y++) {
    for (let x = 0; x < MAP_CELLS_W; x++) {
      const idx = y * MAP_CELLS_W + x
      // Center of vision: player base at (30, 30)
      const dx = x - 20
      const dy = y - 15
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 12) {
        visibilityGrid[idx] = VIS_VISIBLE
      } else if (dist < 20) {
        visibilityGrid[idx] = VIS_FOG
      } else {
        visibilityGrid[idx] = VIS_NONE
      }
    }
  }
}
initVisibility()

// ---------------------------------------------------------------------------
// Viewport rectangle (in cell coordinates)
// ---------------------------------------------------------------------------

let viewportX = 15
let viewportY = 10
let viewportW = 8
let viewportH = 6

// ---------------------------------------------------------------------------
// Canvas setup
// ---------------------------------------------------------------------------

const canvas = document.getElementById('radar-canvas') as HTMLCanvasElement
canvas.width = RADAR_W
canvas.height = RADAR_H
canvas.style.width = `${RADAR_W}px`
canvas.style.height = `${RADAR_H}px`

const ctx = canvas.getContext('2d')!

// ---------------------------------------------------------------------------
// Render the minimap
// ---------------------------------------------------------------------------

function renderMinimap(): void {
  const imageData = ctx.createImageData(RADAR_W, RADAR_H)
  const data = imageData.data

  // For each radar pixel, determine the source cell and color it
  for (let py = 0; py < RADAR_H; py++) {
    for (let px = 0; px < RADAR_W; px++) {
      const cellX = Math.floor(px / RADAR_SCALE)
      const cellY = Math.floor(py / RADAR_SCALE)
      const cellIdx = cellY * MAP_CELLS_W + cellX
      const terrainType = terrainGrid[cellIdx]
      const vis = visibilityGrid[cellIdx]

      const [tr, tg, tb, ta] = TERRAIN_COLORS[terrainType] || [50, 50, 50, 255]

      let r = tr, g = tg, b = tb, a = ta

      // Apply shroud / fog overlay
      if (vis === VIS_NONE) {
        // Full black
        r = 0; g = 0; b = 0; a = 255
      } else if (vis === VIS_FOG) {
        // Semi-transparent black overlay (50% opacity)
        r = Math.floor(tr * 0.5)
        g = Math.floor(tg * 0.5)
        b = Math.floor(tb * 0.5)
        a = 255
      }
      // VIS_VISIBLE: keep terrain color

      const pixelIdx = (py * RADAR_W + px) * 4
      data[pixelIdx] = r
      data[pixelIdx + 1] = g
      data[pixelIdx + 2] = b
      data[pixelIdx + 3] = a
    }
  }

  ctx.putImageData(imageData, 0, 0)

  // Draw actor dots
  for (const actor of mockActors) {
    // Actor radar position = cell center
    const radarX = actor.x * RADAR_SCALE + RADAR_SCALE / 2
    const radarY = actor.y * RADAR_SCALE + RADAR_SCALE / 2

    // Check if visible
    const cellIdx = Math.floor(actor.y) * MAP_CELLS_W + Math.floor(actor.x)
    if (visibilityGrid[cellIdx] === VIS_NONE) continue

    const [ar, ag, ab] = actor.color
    ctx.fillStyle = `rgb(${ar},${ag},${ab})`
    ctx.beginPath()
    ctx.arc(radarX, radarY, actor.size, 0, Math.PI * 2)
    ctx.fill()

    // Slight border for visibility
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'
    ctx.lineWidth = 0.5
    ctx.stroke()
  }

  // Draw viewport rectangle
  const vprX = viewportX * RADAR_SCALE
  const vprY = viewportY * RADAR_SCALE
  const vprW = viewportW * RADAR_SCALE
  const vprH = viewportH * RADAR_SCALE

  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.5
  ctx.strokeRect(vprX, vprY, vprW, vprH)

  // Viewport rectangle fill (subtle)
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  ctx.fillRect(vprX, vprY, vprW, vprH)
}

// ---------------------------------------------------------------------------
// Click handler: convert radar pixel to cell coordinate
// ---------------------------------------------------------------------------

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect()
  const scaleX = RADAR_W / rect.width
  const scaleY = RADAR_H / rect.height
  const radarPx = (e.clientX - rect.left) * scaleX
  const radarPy = (e.clientY - rect.top) * scaleY
  const cellX = Math.floor(radarPx / RADAR_SCALE)
  const cellY = Math.floor(radarPy / RADAR_SCALE)

  // Clamp
  const cx = Math.max(0, Math.min(MAP_CELLS_W - 1, cellX))
  const cy = Math.max(0, Math.min(MAP_CELLS_H - 1, cellY))

  // Move viewport center to click location
  viewportX = Math.max(0, Math.min(MAP_CELLS_W - viewportW, cx - Math.floor(viewportW / 2)))
  viewportY = Math.max(0, Math.min(MAP_CELLS_H - viewportH, cy - Math.floor(viewportH / 2)))

  document.getElementById('st-click-coord')!.textContent = `cell(${cx}, ${cy})`
  document.getElementById('st-world-coord')!.textContent = `WPos(${cx * 1024}, ${cy * 1024})`

  renderMinimap()
  updateStatus()
})

// ---------------------------------------------------------------------------
// Viewport drag (move viewport by dragging the rectangle)
// ---------------------------------------------------------------------------

let isDragging = false
let dragStartX = 0
let dragStartY = 0
let dragViewportStartX = 0
let dragViewportStartY = 0

canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect()
  const scaleX = RADAR_W / rect.width
  const scaleY = RADAR_H / rect.height
  const mx = (e.clientX - rect.left) * scaleX
  const my = (e.clientY - rect.top) * scaleY
  const cx = Math.floor(mx / RADAR_SCALE)
  const cy = Math.floor(my / RADAR_SCALE)

  // Check if click is near/on the viewport rectangle
  const vprX = viewportX * RADAR_SCALE
  const vprY = viewportY * RADAR_SCALE
  const vprW = viewportW * RADAR_SCALE
  const vprH = viewportH * RADAR_SCALE

  if (mx >= vprX && mx <= vprX + vprW && my >= vprY && my <= vprY + vprH) {
    isDragging = true
    dragStartX = cx
    dragStartY = cy
    dragViewportStartX = viewportX
    dragViewportStartY = viewportY
    canvas.style.cursor = 'grabbing'
  }
})

canvas.addEventListener('mousemove', (e) => {
  if (!isDragging) {
    // Update cursor based on position
    const rect = canvas.getBoundingClientRect()
    const scaleX = RADAR_W / rect.width
    const scaleY = RADAR_H / rect.height
    const mx = (e.clientX - rect.left) * scaleX
    const my = (e.clientY - rect.top) * scaleY

    const vprX = viewportX * RADAR_SCALE
    const vprY = viewportY * RADAR_SCALE
    const vprW = viewportW * RADAR_SCALE
    const vprH = viewportH * RADAR_SCALE

    if (mx >= vprX && mx <= vprX + vprW && my >= vprY && my <= vprY + vprH) {
      canvas.style.cursor = 'grab'
    } else {
      canvas.style.cursor = 'crosshair'
    }
    return
  }

  const rect = canvas.getBoundingClientRect()
  const scaleX = RADAR_W / rect.width
  const scaleY = RADAR_H / rect.height
  const mx = (e.clientX - rect.left) * scaleX
  const my = (e.clientY - rect.top) * scaleY
  const cx = Math.floor(mx / RADAR_SCALE)
  const cy = Math.floor(my / RADAR_SCALE)

  const dx = cx - dragStartX
  const dy = cy - dragStartY

  viewportX = Math.max(0, Math.min(MAP_CELLS_W - viewportW, dragViewportStartX + dx))
  viewportY = Math.max(0, Math.min(MAP_CELLS_H - viewportH, dragViewportStartY + dy))

  renderMinimap()
  updateStatus()
})

canvas.addEventListener('mouseup', () => {
  isDragging = false
  canvas.style.cursor = 'crosshair'
})

canvas.addEventListener('mouseleave', () => {
  isDragging = false
  canvas.style.cursor = 'crosshair'
})

// ---------------------------------------------------------------------------
// Status display updates
// ---------------------------------------------------------------------------

function updateStatus(): void {
  document.getElementById('st-map-size')!.textContent = `${MAP_CELLS_W} x ${MAP_CELLS_H} cells`
  document.getElementById('st-radar-px')!.textContent = `${RADAR_W} x ${RADAR_H} px (${RADAR_SCALE}x scale)`
  document.getElementById('st-viewport-rect')!.textContent = `(${viewportX}, ${viewportY}) ${viewportW}x${viewportH}`

  let visibleCount = 0, fogCount = 0, shroudCount = 0
  for (const v of visibilityGrid) {
    if (v === VIS_VISIBLE) visibleCount++
    else if (v === VIS_FOG) fogCount++
    else shroudCount++
  }
  document.getElementById('st-visible-cells')!.textContent = `${visibleCount}`
  document.getElementById('st-fog-cells')!.textContent = `${fogCount}`
  document.getElementById('st-shroud-cells')!.textContent = `${shroudCount}`
}

// ---------------------------------------------------------------------------
// Button controls
// ---------------------------------------------------------------------------

// Viewport position clamped with: viewportX = Math.max(0, Math.min(MAP_CELLS_W - viewportW, vpX))

document.getElementById('btn-viewport-up')!.addEventListener('click', () => {
  viewportY = Math.max(0, viewportY - 2)
  renderMinimap()
  updateStatus()
})

document.getElementById('btn-viewport-down')!.addEventListener('click', () => {
  viewportY = Math.min(MAP_CELLS_H - viewportH, viewportY + 2)
  renderMinimap()
  updateStatus()
})

document.getElementById('btn-viewport-left')!.addEventListener('click', () => {
  viewportX = Math.max(0, viewportX - 2)
  renderMinimap()
  updateStatus()
})

document.getElementById('btn-viewport-right')!.addEventListener('click', () => {
  viewportX = Math.min(MAP_CELLS_W - viewportW, viewportX + 2)
  renderMinimap()
  updateStatus()
})

document.getElementById('btn-random-shroud')!.addEventListener('click', () => {
  for (let i = 0; i < visibilityGrid.length; i++) {
    const r = Math.random()
    if (r < 0.3) visibilityGrid[i] = VIS_VISIBLE
    else if (r < 0.6) visibilityGrid[i] = VIS_FOG
    else visibilityGrid[i] = VIS_NONE
  }
  renderMinimap()
  updateStatus()
})

document.getElementById('btn-reveal-all')!.addEventListener('click', () => {
  visibilityGrid.fill(VIS_VISIBLE)
  renderMinimap()
  updateStatus()
})

document.getElementById('btn-reset-shroud')!.addEventListener('click', () => {
  initVisibility()
  renderMinimap()
  updateStatus()
})

// ---------------------------------------------------------------------------
// Keyboard: arrow keys move viewport
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'ArrowUp':    viewportY = Math.max(0, viewportY - 1); break
    case 'ArrowDown':  viewportY = Math.min(MAP_CELLS_H - viewportH, viewportY + 1); break
    case 'ArrowLeft':  viewportX = Math.max(0, viewportX - 1); break
    case 'ArrowRight': viewportX = Math.min(MAP_CELLS_W - viewportW, viewportX + 1); break
    default: return
  }
  renderMinimap()
  updateStatus()
})

// ---------------------------------------------------------------------------
// Initial render
// ---------------------------------------------------------------------------

renderMinimap()
updateStatus()

// ---------------------------------------------------------------------------
// Dev console access
// ---------------------------------------------------------------------------

;(window as any).__testHarness = {
  canvas,
  ctx,
  terrainGrid,
  visibilityGrid,
  mockActors,
  viewportX, viewportY, viewportW, viewportH,
  renderMinimap,
  updateStatus,
  getCellColor: (cx: number, cy: number) => {
    if (cx < 0 || cx >= MAP_CELLS_W || cy < 0 || cy >= MAP_CELLS_H) return null
    const idx = cy * MAP_CELLS_W + cx
    return {
      terrain: terrainGrid[idx],
      color: TERRAIN_COLORS[terrainGrid[idx]],
      visibility: visibilityGrid[idx],
    }
  },
}
