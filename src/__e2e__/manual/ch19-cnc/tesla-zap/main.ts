/**
 * ch19-cnc/tesla-zap/main.ts — Tesla zap lightning arc + charge overlay acceptance test
 *
 * Verifies:
 * 1. Lightning arc generation using LinesMesh with dynamic jagged vertices
 * 2. Dim (pale blue, edge) vs Bright (pure white, core) bolt layers
 * 3. Zap duration management (default 2 ticks, then remove)
 * 4. Charge overlay animation: sphere grows + emissive intensity ramps up
 * 5. Random bolt branching (each zap instance has unique path)
 *
 * OpenRA source: OpenRA.Mods.Cnc/Graphics/TeslaZapRenderable.cs (167 lines)
 *                OpenRA.Mods.Cnc/Projectiles/TeslaZap.ts (99 lines)
 *                OpenRA.Mods.Cnc/Traits/Render/WithTeslaChargeOverlay.ts (72 lines)
 *                OpenRA.Mods.Cnc/Traits/Render/WithTeslaChargeAnimation.ts (47 lines)
 *
 * TS source: src/OpenRA.Mods.Cnc/Graphics/TeslaZapRenderable.ts
 *            src/OpenRA.Mods.Cnc/Projectiles/TeslaZap.ts
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
  Mesh,
  LinesMesh,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TICK_RATE = 1000 / 25

// ---------------------------------------------------------------------------
// Seeded random (mirrors TeslaZapRenderable SeededRandom)
// ---------------------------------------------------------------------------

class SeededRandom {
  private _seed: number
  constructor(seed: number) { this._seed = seed }
  next(max: number): number {
    this._seed = (this._seed * 1103515245 + 12345) & 0x7fffffff
    return this._seed % max
  }
  nextFloat(): number {
    return this.next(10000) / 10000
  }
}

// ---------------------------------------------------------------------------
// Lightning generation (mirrors TeslaZapRenderable.drawZapWandering + drawZap)
// ---------------------------------------------------------------------------

interface ZapInstance {
  lines: LinesMesh
  remainingTicks: number
}

function generateLightningBolts(
  scene: Scene,
  from: Vector3,
  to: Vector3,
  brightCount: number,
  dimCount: number,
): ZapInstance[] {
  const result: ZapInstance[] = []

  // Dim zaps (edge — pale blue)
  for (let i = 0; i < dimCount; i++) {
    const { points } = generateArc(from, to, i + 100)
    const lines = MeshBuilder.CreateLines(`dim_${i}`, { points }, scene)
    lines.color = new Color3(0.5, 0.7, 1.0) // #80B3FF — pale blue
    result.push({ lines, remainingTicks: 2 })
  }

  // Bright zaps (core — pure white)
  for (let i = 0; i < brightCount; i++) {
    const { points } = generateArc(from, to, i + 200)
    const lines = MeshBuilder.CreateLines(`bright_${i}`, { points }, scene)
    lines.color = new Color3(1.0, 1.0, 1.0) // #FFFFFF — pure white
    result.push({ lines, remainingTicks: 2 })
  }

  return result
}

function generateArc(from: Vector3, to: Vector3, seed: number): { points: Vector3[] } {
  const rng = new SeededRandom(seed)
  const dist = to.subtract(from)
  const distLen = dist.length()
  if (distLen === 0) return { points: [from.clone(), to.clone()] }

  const norm = new Vector3(-dist.z / distLen, 0, dist.x / distLen).normalize()

  // 2 or 3 segments (mirrors TeslaZapRenderable logic)
  const segmentCount = rng.next(2) !== 0 ? 3 : 2
  const points: Vector3[] = [from.clone()]

  for (let s = 0; s < segmentCount - 1; s++) {
    const t = (s + 1) / segmentCount
    const base = from.add(dist.scale(t))
    const jitter = rng.nextFloat() * distLen * 0.25 - distLen * 0.125
    const midPoint = base.add(norm.scale(jitter))
    points.push(midPoint)
  }
  points.push(to.clone())

  // Add extra zigzag vertices
  const detailedPoints: Vector3[] = [points[0]]
  for (let i = 0; i < points.length - 1; i++) {
    const segStart = points[i]
    const segEnd = points[i + 1]
    const segDist = segEnd.subtract(segStart).length()
    const steps = Math.max(Math.floor(segDist / 0.15), 3)

    for (let j = 1; j <= steps; j++) {
      const t = j / steps
      const p = Vector3.Lerp(segStart, segEnd, t)
      if (j < steps) {
        const perp = new Vector3(-(segEnd.z - segStart.z), 0, segEnd.x - segStart.x).normalize()
        const jt = rng.nextFloat() * 0.15 - 0.075
        p.addInPlace(perp.scale(jt))
      }
      detailedPoints.push(p)
    }
  }

  return { points: detailedPoints }
}

// ---------------------------------------------------------------------------
// Scene Setup
// ---------------------------------------------------------------------------

let engine!: Engine
let scene!: Scene

let teslaTower: Mesh
let targetSphere: Mesh
let chargeOrb: Mesh

let activeZaps: ZapInstance[] = []
let chargeProgress: number = 0  // 0..1
let isCharging: boolean = false
let chargeTicksRemaining: number = 0

let isContinuous: boolean = false
let continuousInterval: number | null = null

function setupScene(): void {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
  scene = new Scene(engine)
  scene.clearColor = new Color4(0.05, 0.08, 0.12, 1)

  const camera = new ArcRotateCamera('camera', -Math.PI / 3, Math.PI / 4, 12, new Vector3(0, 1, 0), scene)
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 3
  camera.upperRadiusLimit = 25

  const hemi = new HemisphericLight('hemi', new Vector3(0.5, 1, -0.3), scene)
  hemi.intensity = 0.5

  // Ground
  const groundMat = new StandardMaterial('gMat', scene)
  groundMat.diffuseColor = new Color3(0.1, 0.12, 0.15)
  const ground = MeshBuilder.CreateGround('ground', { width: 16, height: 16 }, scene)
  ground.material = groundMat

  // Tesla tower (source)
  const towerMat = new StandardMaterial('towerMat', scene)
  towerMat.diffuseColor = new Color3(0.6, 0.6, 0.65)
  towerMat.emissiveColor = new Color3(0.1, 0.1, 0.15)
  teslaTower = MeshBuilder.CreateCylinder('tower', { height: 2.5, diameterTop: 0.3, diameterBottom: 0.6, tessellation: 8 }, scene)
  teslaTower.position = new Vector3(-3, 1.25, 0)
  teslaTower.material = towerMat

  // Tower top (coil)
  const coilMat = new StandardMaterial('coilMat', scene)
  coilMat.diffuseColor = new Color3(0.7, 0.7, 0.8)
  const coil = MeshBuilder.CreateTorus('coil', { diameter: 0.5, thickness: 0.08, tessellation: 16 }, scene)
  coil.position = new Vector3(-3, 2.55, 0)
  coil.material = coilMat

  // Charge orb (invisible initially)
  const orbMat = new StandardMaterial('orbMat', scene)
  orbMat.diffuseColor = new Color3(0.2, 0.6, 1.0)
  orbMat.emissiveColor = new Color3(0.1, 0.3, 0.5)
  chargeOrb = MeshBuilder.CreateSphere('chargeOrb', { diameter: 0.05, segments: 16 }, scene)
  chargeOrb.position = new Vector3(-3, 2.8, 0)
  chargeOrb.material = orbMat
  chargeOrb.isVisible = false

  // Target sphere
  const targetMat = new StandardMaterial('targetMat', scene)
  targetMat.diffuseColor = new Color3(0.9, 0.1, 0.1)
  targetMat.emissiveColor = new Color3(0.3, 0.02, 0.02)
  targetSphere = MeshBuilder.CreateSphere('target', { diameter: 0.3, segments: 16 }, scene)
  targetSphere.position = new Vector3(3, 0.8, 1)
  targetSphere.material = targetMat

  // Target base marker
  const markerMat = new StandardMaterial('markerMat', scene)
  markerMat.diffuseColor = new Color3(0.9, 0.3, 0.1)
  const marker = MeshBuilder.CreateCylinder('marker', { height: 0.05, diameter: 0.5, tessellation: 16 }, scene)
  marker.position = new Vector3(3, 0.025, 1)
  marker.material = markerMat
}

// ---------------------------------------------------------------------------
// Fire zap
// ---------------------------------------------------------------------------

function fireZap(): void {
  clearAllZaps()

  const brightCount = parseInt((document.getElementById('sel-bright') as HTMLSelectElement).value)
  const dimCount = parseInt((document.getElementById('sel-dim') as HTMLSelectElement).value)
  const duration = parseInt((document.getElementById('rng-duration') as HTMLInputElement).value)

  const from = teslaTower.position.add(new Vector3(0, 1.3, 0)) // top of tower
  const to = targetSphere.position

  activeZaps = generateLightningBolts(scene, from, to, brightCount, dimCount)

  // Set duration on all zaps
  for (const zap of activeZaps) {
    zap.remainingTicks = duration
  }
}

function clearAllZaps(): void {
  for (const zap of activeZaps) {
    zap.lines.dispose()
  }
  activeZaps = []
}

function startCharge(): void {
  isCharging = true
  chargeTicksRemaining = 8 // 8 ticks charge-up (320ms @ 25fps)
  chargeProgress = 0
  chargeOrb.isVisible = true
}

// ---------------------------------------------------------------------------
// UI Updates
// ---------------------------------------------------------------------------

function updateStatus(): void {
  document.getElementById('st-zaps')!.textContent = String(activeZaps.length)
  document.getElementById('st-bright')!.textContent = (document.getElementById('sel-bright') as HTMLSelectElement).value
  document.getElementById('st-dim')!.textContent = (document.getElementById('sel-dim') as HTMLSelectElement).value
  const minTicks = activeZaps.length > 0 ? Math.min(...activeZaps.map(z => z.remainingTicks)) : 0
  document.getElementById('st-ticks')!.textContent = String(minTicks)
  document.getElementById('st-charge')!.textContent = isCharging ? 'CHARGING' : 'IDLE'
  document.getElementById('st-charge-progress')!.textContent = chargeProgress.toFixed(2)
}

function updateInfoBar(): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  document.getElementById('info-viewport')!.textContent = `${window.innerWidth}x${window.innerHeight}`
  document.getElementById('info-engine')!.textContent = engine.webGLVersion === 2 ? 'WebGL 2.0' : 'WebGL 1.0'
  document.getElementById('info-fps')!.textContent = String(Math.round(engine.getFps()))
  document.getElementById('info-time')!.textContent = new Date().toISOString()
  document.getElementById('info-tickrate')!.textContent = '25 ticks/s (模拟)'
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function setupControls(): void {
  document.getElementById('btn-fire')!.addEventListener('click', () => {
    fireZap()
  })

  document.getElementById('btn-continuous')!.addEventListener('click', function(this: HTMLButtonElement) {
    isContinuous = !isContinuous
    this.classList.toggle('active', isContinuous)
    if (isContinuous) {
      continuousInterval = window.setInterval(() => fireZap(), 400) // every ~10 ticks
    } else {
      if (continuousInterval !== null) { clearInterval(continuousInterval); continuousInterval = null }
    }
  })

  document.getElementById('btn-charge')!.addEventListener('click', () => {
    startCharge()
  })

  document.getElementById('rng-duration')!.addEventListener('input', function(this: HTMLInputElement) {
    document.getElementById('lbl-duration')!.textContent = `${this.value} ticks`
  })

  document.getElementById('btn-reset')!.addEventListener('click', () => {
    clearAllZaps()
    isCharging = false
    chargeOrb.isVisible = false
    if (continuousInterval !== null) { clearInterval(continuousInterval); continuousInterval = null }
    isContinuous = false
    document.getElementById('btn-continuous')!.classList.remove('active')
  })
}

// ---------------------------------------------------------------------------
// Main Loop
// ---------------------------------------------------------------------------

setupScene()
setupControls()

let tickAcc = 0

engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime()
  tickAcc += dt

  while (tickAcc >= TICK_RATE) {
    tickAcc -= TICK_RATE

    // Tick charge animation
    if (isCharging) {
      chargeTicksRemaining--
      chargeProgress = (8 - chargeTicksRemaining) / 8

      // Orb grows from 0.05 to 0.5 diameter
      const diam = 0.05 + chargeProgress * 0.45
      const orbMat = chargeOrb.material as StandardMaterial
      orbMat.emissiveColor = new Color3(0.1 + chargeProgress * 0.9, 0.3 + chargeProgress * 0.7, 0.5 + chargeProgress * 0.5)
      chargeOrb.scaling = new Vector3(diam / 0.05, diam / 0.05, diam / 0.05)

      if (chargeTicksRemaining <= 0) {
        isCharging = false
        fireZap()  // Fire on charge completion
        // Reset orb
        chargeOrb.scaling = Vector3.One()
        chargeOrb.isVisible = false
      }
    }

    // Tick active zaps — decrement ticks and remove expired
    const toRemove: ZapInstance[] = []
    for (const zap of activeZaps) {
      zap.remainingTicks--
      if (zap.remainingTicks <= 0) {
        zap.lines.dispose()
        toRemove.push(zap)
      }
    }
    activeZaps = activeZaps.filter(z => !toRemove.includes(z))
  }

  updateStatus()
  updateInfoBar()
  scene.render()
})

window.addEventListener('resize', () => { engine.resize() })
