/**
 * production-queue/main.ts — Production queue UI visual acceptance test
 *
 * OpenRA对照: OpenRA.Mods.Common/Traits/Player/ProductionQueue.ts
 *            OpenRA.Mods.Common/Traits/Player/ClassicProductionQueue.ts
 *
 * Verifies:
 *   E1. Progress bar fills linearly from 0→100% over the configured build time
 *   E2. Countdown timer shows correct remaining seconds (±0.5s accuracy)
 *   E3. Ready item pulses with glow emission oscillating every 1s
 *   E4. Cancel triggers cost refund (displayed as refund badge)
 *   E5. Cancel head-of-queue triggers reorder; next item starts progressing
 */

import {
  Engine, Scene, ArcRotateCamera, HemisphericLight,
  Vector3, Color3, Color4, MeshBuilder, StandardMaterial,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Scene setup
// ---------------------------------------------------------------------------

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true })
const scene = new Scene(engine)
scene.clearColor = new Color4(0.04, 0.07, 0.12, 1)

const camera = new ArcRotateCamera('cam', -Math.PI / 3, Math.PI / 3.5, 10, new Vector3(5, 2, 5), scene)
camera.lowerRadiusLimit = 4; camera.upperRadiusLimit = 30; camera.attachControl(canvas, true)

const light = new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)
light.intensity = 0.8

// Ground
const ground = MeshBuilder.CreateGround('gnd', { width: 16, height: 16 }, scene)
ground.position.y = -0.02
const gm = new StandardMaterial('gm', scene)
gm.diffuseColor = new Color3(0.08, 0.11, 0.16); gm.specularColor = new Color3(0, 0, 0); gm.alpha = 0.7
ground.material = gm

// Factory building (pulses when item ready)
const factory = MeshBuilder.CreateBox('factory', { width: 1.6, height: 1.2, depth: 1.4 }, scene)
factory.position = new Vector3(5, 0.6, 5)
const factoryMat = new StandardMaterial('factoryMat', scene)
factoryMat.diffuseColor = new Color3(0.35, 0.4, 0.45)
factoryMat.specularColor = new Color3(0.1, 0.1, 0.1)
factory.material = factoryMat

// Progress ring (torus around the factory that fills as progress advances)
const progressRing = MeshBuilder.CreateTorus('ring', { diameter: 2, thickness: 0.06, tessellation: 64 }, scene)
progressRing.position = new Vector3(5, 0.3, 5)
progressRing.rotation.x = Math.PI / 2
const ringMat = new StandardMaterial('ringMat', scene)
ringMat.diffuseColor = new Color3(0.1, 0.7, 0.3)
ringMat.emissiveColor = new Color3(0.05, 0.35, 0.15)
ringMat.specularColor = new Color3(0, 0, 0)
ringMat.disableLighting = true
ringMat.alpha = 0.85
progressRing.material = ringMat

// Chimney (small indicator on top)
const chimney = MeshBuilder.CreateCylinder('chimney', { height: 0.4, diameterTop: 0.15, diameterBottom: 0.25, tessellation: 16 }, scene)
chimney.position = new Vector3(5.4, 1.4, 5.4)
const chimneyMat = new StandardMaterial('chimneyMat', scene)
chimneyMat.diffuseColor = new Color3(0.2, 0.2, 0.25)
chimneyMat.specularColor = new Color3(0, 0, 0)
chimney.material = chimneyMat

// ---------------------------------------------------------------------------
// Simulation state
// ---------------------------------------------------------------------------

interface QueueItem {
  type: string
  name: string
  icon: string
  totalTime: number   // build time in seconds
  remainingTime: number // remaining time in seconds
  cost: number
  isReady: boolean
  refunded: boolean
  refundAmount: number
}

const BUILDABLE_ITEMS: Record<string, { name: string; icon: string; time: number; cost: number }> = {
  infantry:  { name: 'Rifle Infantry',      icon: '\u{1F396}', time: 5,   cost: 100 },
  engineer:  { name: 'Engineer',             icon: '\u{1F527}', time: 6,   cost: 200 },
  rocket:    { name: 'Rocket Soldier',       icon: '\u{1F3AF}', time: 8,   cost: 300 },
  lightTank: { name: 'Light Tank',           icon: '\u{1F6E1}', time: 10,  cost: 600 },
  medTank:   { name: 'Medium Tank',          icon: '\u{26E9}',  time: 15,  cost: 800 },
  harvester: { name: 'Ore Harvester',        icon: '\u{26CF}',  time: 12,  cost: 1400 },
  mcv:       { name: 'Mobile Constr. Veh.',  icon: '\u{1F69B}', time: 25,  cost: 2500 },
}

const queue: QueueItem[] = []
let isRunning = true
let lastTick = performance.now()
let SIM_SPEED = 1.0
let completedCount = 0
let refundedTotal = 0

// Pulse state
let pulsePhase = 0          // 0..1, wraps every 1s
let hasReadyItem = false

// ---------------------------------------------------------------------------
// Queue operations
// ---------------------------------------------------------------------------

function enqueueItem(type: string): boolean {
  const def = BUILDABLE_ITEMS[type]
  if (!def) { return false }

  const item: QueueItem = {
    type,
    name: def.name,
    icon: def.icon,
    totalTime: def.time,
    remainingTime: def.time,
    cost: def.cost,
    isReady: false,
    refunded: false,
    refundAmount: 0,
  }
  queue.push(item)
  const el = document.getElementById('feedback')!
  el.textContent = `Enqueued: ${def.name} (${def.time}s, $${def.cost})`
  el.style.color = '#7ec8e3'
  updateQueueUI()
  updateItemCounts()
  return true
}

function cancelItem(index: number): boolean {
  if (index < 0 || index >= queue.length) { return false }
  const item = queue[index]

  // Calculate refund
  if (!item.isReady) {
    const progress = 1 - item.remainingTime / item.totalTime
    const refund = Math.floor(item.cost * (1 - progress) * 0.75) // 75% refund for partial
    item.refundAmount = refund
    item.refunded = true
    refundedTotal += refund

    const el = document.getElementById('feedback')!
    el.textContent = `Cancelled: ${item.name} — Refunded $${refund}`
    el.style.color = '#f0ad4e'
  } else {
    // Already ready items don't refund
    item.refunded = true
    item.refundAmount = 0
    const el = document.getElementById('feedback')!
    el.textContent = `Removed: ${item.name} (already complete, no refund)`
    el.style.color = '#999'
  }

  queue.splice(index, 1)
  hasReadyItem = queue.some(q => q.isReady)
  updateQueueUI()
  updateItemCounts()
  return true
}

function reset(): void {
  queue.length = 0
  isRunning = true
  completedCount = 0
  refundedTotal = 0
  pulsePhase = 0
  hasReadyItem = false
  lastTick = performance.now()
  ringMat.emissiveColor.set(0.05, 0.35, 0.15)
  chimneyMat.emissiveColor.set(0, 0, 0)
  factoryMat.emissiveColor.set(0, 0, 0)
  const el = document.getElementById('feedback')!
  el.textContent = 'Queue reset.'
  el.style.color = '#a0a0b0'
  updateQueueUI()
  updateItemCounts()
}

// ---------------------------------------------------------------------------
// Simulation tick (runs every frame, advances simulation time)
// ---------------------------------------------------------------------------

function tick(now: number): void {
  if (!isRunning) { return }

  const rawDelta = (now - lastTick) / 1000  // seconds elapsed real-time
  lastTick = now
  const dt = rawDelta * SIM_SPEED

  // Advance all items
  let anyChanged = false
  for (const item of queue) {
    if (item.isReady || item.refunded) { continue }

    item.remainingTime -= dt
    if (item.remainingTime <= 0) {
      item.remainingTime = 0
      item.isReady = true
      completedCount++
      anyChanged = true

      // Pulse when an item completes
      if (!hasReadyItem) {
        hasReadyItem = true
        pulsePhase = 0
      }

      const el = document.getElementById('feedback')!
      el.textContent = `READY: ${item.name} — Click to deploy!`
      el.style.color = '#5cb85c'
    }
  }

  // BUG-1 fix: updateQueueUI() called every frame to keep timers and progress bars live
  updateQueueUI()

  if (anyChanged) {
    // BUG-2 fix: update item count statistics when items complete in this tick
    updateItemCounts()
  }

  // Update pulse animation
  if (hasReadyItem) {
    pulsePhase = (pulsePhase + dt) % 2.0  // 2s full cycle

    // Emissions oscillate with sin (clamped to non-negative)
    const t = Math.sin(pulsePhase * Math.PI)  // -1..+1 over 2s
    const intensity = Math.abs(t) * 0.5

    // Factory glow
    factoryMat.emissiveColor.set(intensity * 0.3, intensity * 0.7, intensity * 0.3)
    chimneyMat.emissiveColor.set(intensity * 0.8, intensity * 0.2, 0)
    ringMat.emissiveColor.set(intensity * 0.3, intensity * 0.9, intensity * 0.3)
  } else {
    factoryMat.emissiveColor.set(0, 0, 0)
    chimneyMat.emissiveColor.set(0, 0, 0)
    ringMat.emissiveColor.set(0.05, 0.35, 0.15)
  }
}

// ---------------------------------------------------------------------------
// Queue UI rendering (HTML overlay)
// ---------------------------------------------------------------------------

function updateQueueUI(): void {
  const listEl = document.getElementById('queue-list')!
  if (queue.length === 0) {
    listEl.innerHTML = '<div class="empty-q">Queue empty — use controls to enqueue items</div>'
    return
  }

  let html = ''
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]
    const progress = item.totalTime > 0
      ? Math.min(1, 1 - item.remainingTime / item.totalTime)
      : 1
    const progressPct = Math.round(progress * 100)
    const isHead = i === 0

    if (item.isReady) {
      html += `
        <div class="q-item q-ready ${isHead ? 'q-head' : ''}">
          <span class="q-icon">${item.icon}</span>
          <div class="q-info">
            <div class="q-name">${item.name} <span class="q-cost">$${item.cost}</span></div>
            <div class="q-status ready-label">READY — Pulse Active</div>
          </div>
          <button class="q-cancel" data-index="${i}" title="Deploy">&#x2705;</button>
        </div>
      `
    } else if (item.refunded) {
      html += `
        <div class="q-item q-refunded">
          <span class="q-icon">${item.icon}</span>
          <div class="q-info">
            <div class="q-name">${item.name}</div>
            <div class="q-status refund-label">Refunded: $${item.refundAmount}</div>
          </div>
          <span class="q-index">#${i + 1}</span>
        </div>
      `
    } else {
      const barColor = progressPct < 30 ? '#3498db' : progressPct < 70 ? '#f39c12' : '#2ecc71'
      html += `
        <div class="q-item ${isHead ? 'q-head' : ''}">
          <span class="q-icon">${item.icon}</span>
          <div class="q-info">
            <div class="q-name">${item.name} <span class="q-cost">$${item.cost}</span></div>
            <div class="q-bar-track">
              <div class="q-bar-fill" style="width:${progressPct}%;background:${barColor}"></div>
            </div>
          </div>
          <div class="q-meta">
            <span class="q-timer">${item.remainingTime.toFixed(1)}s</span>
            <span class="q-pct">${progressPct}%</span>
          </div>
          <button class="q-cancel" data-index="${i}" title="Cancel">&#x2715;</button>
        </div>
      `
    }
  }

  listEl.innerHTML = html

  // Re-bind cancel buttons
  listEl.querySelectorAll('.q-cancel').forEach(btn => {
    btn.addEventListener('click', function(this: HTMLButtonElement) {
      const idx = parseInt(this.dataset.index ?? '-1')
      cancelItem(idx)
    })
  })
}

function updateItemCounts(): void {
  const readyCount = queue.filter(q => q.isReady).length
  const activeCount = queue.filter(q => !q.isReady && !q.refunded).length
  document.getElementById('count-ready')!.textContent = String(readyCount)
  document.getElementById('count-active')!.textContent = String(activeCount)
  document.getElementById('count-total')!.textContent = String(queue.length)
  document.getElementById('diag-completed')!.textContent = String(completedCount)
  document.getElementById('diag-refunded')!.textContent = `$${refundedTotal}`
}

// ---------------------------------------------------------------------------
// Progress ring update (visualizes head item progress)
// ---------------------------------------------------------------------------

function updateProgressRing(): void {
  if (queue.length === 0) {
    ringMat.alpha = 0.3
    return
  }
  const head = queue[0]
  if (head.isReady) {
    ringMat.alpha = 0.85
    return
  }
  const progress = head.totalTime > 0
    ? 1 - head.remainingTime / head.totalTime
    : 1
  ringMat.alpha = 0.3 + progress * 0.55

  // Color shift: blue → yellow → green
  if (progress < 0.5) {
    ringMat.diffuseColor.set(
      0.1 + progress * 1.6,
      0.7 - progress * 0.4,
      0.3 + progress * 0.4,
    )
  } else {
    ringMat.diffuseColor.set(
      0.9 - (progress - 0.5) * 1.0,
      0.5 + (progress - 0.5) * 0.2,
      0.5 + (progress - 0.5) * 0.3,
    )
  }
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

let lastFps = 0; let cachedFps = '0'

engine.runRenderLoop(() => {
  const now = performance.now()
  tick(now)

  updateProgressRing()

  scene.render()

  if (now - lastFps > 500) {
    cachedFps = engine.getFps().toFixed(1)
    lastFps = now
  }

  const set = (id: string, v: string) => { const el = document.getElementById(id); if (el) el.textContent = v }
  set('info-fps', cachedFps)
  set('info-ua', navigator.userAgent.slice(0, 80))
  set('info-viewport', window.innerWidth + 'x' + window.innerHeight)
  set('info-engine', 'WebGL 2.0')
  set('info-time', new Date().toLocaleTimeString())
  set('diag-speed', SIM_SPEED.toFixed(1) + 'x')
  set('diag-pulse', pulsePhase.toFixed(2))
})

window.addEventListener('resize', () => engine.resize())

// ---------------------------------------------------------------------------
// UI controls
// ---------------------------------------------------------------------------

const selUnit = document.getElementById('selUnit') as HTMLSelectElement
const sldSpeed = document.getElementById('sldSpeed') as HTMLInputElement

function setupControls(): void {
  // Populate unit selector
  for (const [key, def] of Object.entries(BUILDABLE_ITEMS)) {
    const opt = document.createElement('option')
    opt.value = key
    opt.textContent = `${def.name} (${def.time}s, $${def.cost})`
    selUnit.appendChild(opt)
  }

  // Enqueue button
  document.getElementById('btnEnqueue')!.addEventListener('click', () => {
    enqueueItem(selUnit.value)
  })

  // Cancel head button
  document.getElementById('btnCancelHead')!.addEventListener('click', () => {
    if (queue.length > 0) {
      cancelItem(0)
    } else {
      const el = document.getElementById('feedback')!
      el.textContent = 'Queue empty — nothing to cancel.'
      el.style.color = '#999'
    }
  })

  // Reset button
  document.getElementById('btnReset')!.addEventListener('click', reset)

  // Speed slider
  sldSpeed.addEventListener('input', function(this: HTMLInputElement) {
    SIM_SPEED = parseFloat(this.value)
    document.getElementById('valSpeed')!.textContent = SIM_SPEED.toFixed(1) + 'x'
    document.getElementById('diag-speed')!.textContent = SIM_SPEED.toFixed(1) + 'x'
  })

  // Pause toggle
  document.getElementById('btnPause')!.addEventListener('click', function() {
    isRunning = !isRunning
    const btn = this as HTMLButtonElement
    btn.textContent = isRunning ? '⏸ Pause' : '▶ Resume'
  })
}

setupControls()
updateQueueUI()
updateItemCounts()

// ---------------------------------------------------------------------------
// Test harness (exposed for Playwright automation)
// ---------------------------------------------------------------------------

;(window as any).__testHarness = {
  enqueueItem(type: string): boolean {
    return enqueueItem(type)
  },

  getQueueItems(): Array<{ type: string; name: string; progressPct: number; remainingTime: number; isReady: boolean }> {
    return queue.map(item => ({
      type: item.type,
      name: item.name,
      progressPct: item.totalTime > 0
        ? Math.round((1 - item.remainingTime / item.totalTime) * 10000) / 100
        : 100,
      remainingTime: Math.round(item.remainingTime * 100) / 100,
      isReady: item.isReady,
    }))
  },

  getProgressPercent(): number {
    if (queue.length === 0) { return 0 }
    const head = queue[0]
    if (head.isReady) { return 100 }
    if (head.totalTime <= 0) { return 100 }
    return Math.round((1 - head.remainingTime / head.totalTime) * 10000) / 100
  },

  getTimeRemaining(): number {
    if (queue.length === 0) { return 0 }
    const head = queue[0]
    return Math.round(head.remainingTime * 100) / 100
  },

  isReadyPulsing(): boolean {
    return hasReadyItem && (Math.sin(pulsePhase * Math.PI)) > 0.1
  },

  cancelItem(index: number): boolean {
    return cancelItem(index)
  },

  reset(): void {
    reset()
  },

  getSimulationSpeed(): number {
    return SIM_SPEED
  },

  setSimulationSpeed(speed: number): void {
    SIM_SPEED = Math.max(0.1, Math.min(20, speed))
    document.getElementById('valSpeed')!.textContent = SIM_SPEED.toFixed(1) + 'x'
  },

  getCompletedCount(): number {
    return completedCount
  },

  getRefundedTotal(): number {
    return refundedTotal
  },
}
