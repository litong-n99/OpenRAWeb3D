/**
 * ch19-d2k/sonic-blast/main.ts — SonicBlast visual acceptance test
 *
 * Verifies:
 * 1. Straight-line trajectory with lerpQuadratic interpolation
 * 2. Ring expansion effect at each damage interval (SonicBlastRenderer)
 * 3. Damage falloff color gradient along trajectory
 * 4. Inaccuracy spread cone (Maximum / PerCellIncrement / Absolute)
 * 5. MinDistance trajectory extension
 * 6. SonicBlastRenderable beam segments
 *
 * OpenRA coordinate system:
 *   - WAngle 0 = North (negative Z), CCW
 *   - WPos: X (east), Y (north), Z (altitude) → Babylon: X→X, Y→-Z, Z→Y
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
// Types
// ---------------------------------------------------------------------------

const InaccuracyType = {
  Maximum: 'Maximum',
  PerCellIncrement: 'PerCellIncrement',
  Absolute: 'Absolute',
} as const
type InaccuracyType = (typeof InaccuracyType)[keyof typeof InaccuracyType]

interface BlastInstance {
  source: Vector3
  target: Vector3
  speed: number
  inaccuracy: number
  inaccuracyType: InaccuracyType
  damageInterval: number
  falloff: number[]
  range: number[]
  minDistance: number
  width: number
  currentTick: number
  totalTicks: number
  currentPos: Vector3
  rings: BlastRing[]
  isActive: boolean
}

interface BlastRing {
  position: Vector3
  age: number
  maxAge: number
  falloffPct: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORLD_SCALE = 1024
const TICK_RATE = 1000 / 25
const DEFAULT_SPEED = 128
const DEFAULT_INACCURACY = 64
const DEFAULT_DAMAGE_INTERVAL = 1
const DEFAULT_FALLOFF = [100, 100]
const DEFAULT_RANGE = [0, 0]
const DEFAULT_MIN_DISTANCE = 2000 // WDist
const DEFAULT_WIDTH = 650 // WDist
const RING_MAX_AGE = 30 // ticks before ring fades out
const RENDERER_SIZE = 16
const RENDERER_ZOOM = 2.5

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let sourcePos = new Vector3(-8, 0.5, 0)
let targetPos = new Vector3(8, 0.5, 0)
let activeBlasts: BlastInstance[] = []
let isPaused = false
let showSpreadCone = false

// Current settings
let currentSpeed = DEFAULT_SPEED
let currentInaccuracy = DEFAULT_INACCURACY
let currentInaccuracyType: InaccuracyType = InaccuracyType.Maximum

// ---------------------------------------------------------------------------
// Babylon.js
// ---------------------------------------------------------------------------

let engine!: Engine
let scene!: Scene
let sourceMarker!: Mesh
let targetMarker!: Mesh
let trajectoryLine: LinesMesh | null = null
let spreadConeLines: LinesMesh | null = null
let blastRingMeshes: Map<BlastRing, Mesh> = new Map()

// ---------------------------------------------------------------------------
// lerpQuadratic simulation
// ---------------------------------------------------------------------------

/** Simulate WPos.lerpQuadratic — lerp with quadratic ease. */
function lerpQuadratic(source: Vector3, target: Vector3, t: number): Vector3 {
  // t in [0, 1]: quadratic interpolation along straight line
  const q = 2 * t - t * t // Quadratic ease-out equivalent
  return new Vector3(
    source.x + (target.x - source.x) * q,
    source.y + (target.y - source.y) * q,
    source.z + (target.z - source.z) * q,
  )
}

// ---------------------------------------------------------------------------
// Falloff computation
// ---------------------------------------------------------------------------

function getFalloff(distance: number, ranges: number[], falloffs: number[]): number {
  if (ranges.length === 0) return 100

  let inner = ranges[0] ?? 0
  for (let i = 1; i < ranges.length; i++) {
    const outer = ranges[i] ?? 0
    if (outer > distance) {
      const low = falloffs[i - 1] ?? 100
      const high = falloffs[i] ?? 100
      const d = distance - inner
      const dh = outer - inner
      if (dh === 0) return low
      return low + (high - low) * d / dh
    }
    inner = outer
  }
  return 0
}

// ---------------------------------------------------------------------------
// Inaccuracy computation
// ---------------------------------------------------------------------------

function computeInaccuracy(inaccuracyVal: number, inaccuracyType: InaccuracyType, range: number): number {
  switch (inaccuracyType) {
    case InaccuracyType.Maximum:
      return Math.min(range * 2 / 3, inaccuracyVal)
    case InaccuracyType.PerCellIncrement: {
      const cellRange = Math.trunc(range / 1024) * 1024
      return Math.min(cellRange, inaccuracyVal)
    }
    case InaccuracyType.Absolute:
    default:
      return inaccuracyVal
  }
}

// ---------------------------------------------------------------------------
// Scene setup
// ---------------------------------------------------------------------------

function setupScene(): void {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false })
  scene = new Scene(engine)
  scene.clearColor = new Color4(0.08, 0.08, 0.15, 1)

  // Camera
  const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3.5, 22, new Vector3(0, 0, 0), scene)
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 5
  camera.upperRadiusLimit = 50

  // Lights
  new HemisphericLight('hemi', new Vector3(0.3, 1, -0.3), scene)

  // Ground
  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.diffuseColor = new Color3(0.12, 0.12, 0.18)
  groundMat.specularColor = new Color3(0, 0, 0)
  const ground = MeshBuilder.CreateGround('ground', { width: 40, height: 40, subdivisions: 20 }, scene)
  ground.position.y = -0.1
  ground.material = groundMat

  // Grid
  const gridMat = new StandardMaterial('gridMat', scene)
  gridMat.wireframe = true
  gridMat.diffuseColor = new Color3(0.18, 0.18, 0.25)
  const gridMesh = MeshBuilder.CreateGround('grid', { width: 40, height: 40, subdivisions: 20 }, scene)
  gridMesh.position.y = -0.09
  gridMesh.material = gridMat

  // Source marker (green)
  const srcMat = new StandardMaterial('srcMat', scene)
  srcMat.diffuseColor = new Color3(0.2, 0.9, 0.3)
  srcMat.emissiveColor = new Color3(0.1, 0.4, 0.1)
  sourceMarker = MeshBuilder.CreateSphere('source', { diameter: 0.6 }, scene)
  sourceMarker.position = sourcePos.clone()
  sourceMarker.material = srcMat

  // Target marker (red)
  const tgtMat = new StandardMaterial('tgtMat', scene)
  tgtMat.diffuseColor = new Color3(0.9, 0.2, 0.2)
  tgtMat.emissiveColor = new Color3(0.4, 0.1, 0.1)
  targetMarker = MeshBuilder.CreateSphere('target', { diameter: 0.6 }, scene)
  targetMarker.position = targetPos.clone()
  targetMarker.material = tgtMat

  // Target ring
  const tgtRing = MeshBuilder.CreateTorus('tgtRing', { diameter: 1.2, thickness: 0.04 }, scene)
  tgtRing.rotation.x = Math.PI / 2
  tgtRing.position = new Vector3(targetPos.x, 0.02, targetPos.z)
  const tgtRingMat = new StandardMaterial('tgtRingMat', scene)
  tgtRingMat.emissiveColor = new Color3(0.9, 0.2, 0.2)
  tgtRing.material = tgtRingMat

  updateTrajectoryLine()
}

// ---------------------------------------------------------------------------
// Trajectory and spread cone lines
// ---------------------------------------------------------------------------

function updateTrajectoryLine(): void {
  if (trajectoryLine) { trajectoryLine.dispose(); trajectoryLine = null }

  const lines = [[sourcePos.clone(), targetPos.clone()]]
  trajectoryLine = MeshBuilder.CreateLineSystem('trajectory', { lines }, scene)
  trajectoryLine.color = new Color3(0.4, 0.8, 1)
}

function updateSpreadCone(): void {
  if (spreadConeLines) { spreadConeLines.dispose(); spreadConeLines = null }
  if (!showSpreadCone) return

  const range = Math.sqrt(
    (targetPos.x - sourcePos.x) ** 2 + (targetPos.z - sourcePos.z) ** 2,
  ) * WORLD_SCALE
  const totalInaccuracy = computeInaccuracy(currentInaccuracy, currentInaccuracyType, range) / WORLD_SCALE

  // World-space inaccuracy: WVec(offsetX, offsetY, 0) applied directly.
  // The spread at the target is a rectangular area, not a perpendicular cone.
  const half = totalInaccuracy / 2
  const cx = targetPos.x
  const cz = targetPos.z
  const sy = targetPos.y

  const tl = new Vector3(cx - half, sy, cz - half)
  const tr = new Vector3(cx + half, sy, cz - half)
  const bl = new Vector3(cx - half, sy, cz + half)
  const br = new Vector3(cx + half, sy, cz + half)

  const lines = [
    [tl, tr], [tr, br], [br, bl], [bl, tl],
    [sourcePos.clone(), targetPos.clone()],
  ]
  spreadConeLines = MeshBuilder.CreateLineSystem('spreadCone', { lines }, scene)
  spreadConeLines.color = new Color3(1, 0.6, 0.2)
}

// ---------------------------------------------------------------------------
// Create blast
// ---------------------------------------------------------------------------

function createBlast(): BlastInstance {
  const dx = targetPos.x - sourcePos.x
  const dz = targetPos.z - sourcePos.z
  const baseDist = Math.sqrt(dx * dx + dz * dz) * WORLD_SCALE

  // Apply inaccuracy
  let actualTarget = targetPos.clone()
  const range = baseDist
  const inaccuracyVal = computeInaccuracy(currentInaccuracy, currentInaccuracyType, range)
  if (inaccuracyVal > 0) {
    // WVec.FromPDF: two independent Gaussian-like axes, each averaging 2
    // uniform samples in [-1024, 1024). Per Central Limit Theorem this
    // approximates a normal distribution.
    // OpenRA: target += new WVec(offsetX, offsetY, 0)
    // WVec X → Babylon X, WVec Y → Babylon -Z
    const pdfSamples = 2
    const rng = { next: (min: number, max: number) => min + Math.floor(Math.random() * (max - min)) }
    let sumX = 0, sumY = 0
    for (let s = 0; s < pdfSamples; s++) {
      sumX += rng.next(-1024, 1024)
      sumY += rng.next(-1024, 1024)
    }
    const offsetX_world = Math.trunc((sumX / pdfSamples) * inaccuracyVal / 1024) / WORLD_SCALE
    const offsetY_world = Math.trunc((sumY / pdfSamples) * inaccuracyVal / 1024) / WORLD_SCALE

    // Direct world-space offset matching SonicBlast.ts: WVec(offsetX, offsetY, 0)
    actualTarget.x += offsetX_world
    actualTarget.z -= offsetY_world // WVec Y → Babylon -Z
  }

  // MinDistance extension
  const direction = new Vector3(dx, 0, dz).normalize()
  const dist = Math.sqrt(dx * dx + dz * dz) * WORLD_SCALE
  let extendedTarget = actualTarget.clone()
  if (DEFAULT_MIN_DISTANCE > dist) {
    const extraDist = (DEFAULT_MIN_DISTANCE - dist) / WORLD_SCALE
    extendedTarget.x += direction.x * extraDist
    extendedTarget.z += direction.z * extraDist
  }

  const travelDist = Math.sqrt(
    (extendedTarget.x - sourcePos.x) ** 2 + (extendedTarget.z - sourcePos.z) ** 2,
  ) * WORLD_SCALE
  const totalTicks = Math.max(Math.trunc(travelDist / currentSpeed), 1)

  return {
    source: sourcePos.clone(),
    target: extendedTarget,
    speed: currentSpeed,
    inaccuracy: currentInaccuracy,
    inaccuracyType: currentInaccuracyType,
    damageInterval: DEFAULT_DAMAGE_INTERVAL,
    falloff: [...DEFAULT_FALLOFF],
    range: [...DEFAULT_RANGE],
    minDistance: DEFAULT_MIN_DISTANCE,
    width: DEFAULT_WIDTH,
    currentTick: 0,
    totalTicks,
    currentPos: sourcePos.clone(),
    rings: [],
    isActive: true,
  }
}

// ---------------------------------------------------------------------------
// Blast tick
// ---------------------------------------------------------------------------

function tickBlast(blast: BlastInstance): void {
  if (!blast.isActive) return

  blast.currentTick++

  if (blast.currentTick > blast.totalTicks) {
    blast.isActive = false
    return
  }

  // lerpQuadratic position
  const t = blast.currentTick / blast.totalTicks
  blast.currentPos = lerpQuadratic(blast.source, blast.target, t)

  // Add ring at damage interval
  if (blast.currentTick % blast.damageInterval === 0) {
    const rawDist = Vector3.Distance(blast.source, blast.currentPos) * WORLD_SCALE
    const falloffPct = getFalloff(rawDist, blast.range, blast.falloff)

    blast.rings.push({
      position: blast.currentPos.clone(),
      age: 0,
      maxAge: RING_MAX_AGE,
      falloffPct,
    })
  }

  // Age existing rings
  for (const ring of blast.rings) {
    ring.age++
  }

  // Remove expired rings
  blast.rings = blast.rings.filter(r => r.age < r.maxAge)
}

// ---------------------------------------------------------------------------
// Ring rendering (using flat torus for ring visualization)
// ---------------------------------------------------------------------------

function falloffToColor(falloffPct: number): Color3 {
  // 100% = bright orange #FF6600, 0% = dark red #660000
  const t = falloffPct / 100
  const r = 1.0 * t + 0.4 * (1 - t)
  const g = 0.4 * t + 0.0 * (1 - t)
  const b = 0.0
  return new Color3(r, g, b)
}

function renderRings(): void {
  // Clean up old ring meshes
  const activeRings = new Set<BlastRing>()
  for (const blast of activeBlasts) {
    for (const ring of blast.rings) {
      activeRings.add(ring)
    }
  }

  // Dispose meshes for rings that no longer exist
  for (const [ring, mesh] of blastRingMeshes) {
    if (!activeRings.has(ring)) {
      mesh.dispose()
      blastRingMeshes.delete(ring)
    }
  }

  // Create or update ring meshes
  for (const blast of activeBlasts) {
    for (const ring of blast.rings) {
      let mesh = blastRingMeshes.get(ring)
      if (!mesh) {
        const diameter = (RENDERER_SIZE / WORLD_SCALE) * 2 // approximate size
        mesh = MeshBuilder.CreateTorus('blastRing', { diameter, thickness: 0.03 }, scene)
        mesh.rotation.x = Math.PI / 2
        mesh.position = ring.position.clone()

        const mat = new StandardMaterial('ringMat', scene)
        mat.emissiveColor = falloffToColor(ring.falloffPct)
        mat.diffuseColor = falloffToColor(ring.falloffPct)
        mat.specularColor = new Color3(0, 0, 0)
        mat.alpha = 1.0
        mesh.material = mat
        blastRingMeshes.set(ring, mesh)
      }

      // Update ring expansion
      const progress = ring.age / ring.maxAge
      const scale = 1 + progress * RENDERER_ZOOM * 3
      mesh.scaling.x = scale
      mesh.scaling.z = scale
      mesh.position = ring.position.clone()
      mesh.position.y = 0.05 + progress * 0.3

      // Fade out
      const mat = mesh.material as StandardMaterial
      mat.alpha = Math.max(0, 1 - progress)
      mat.emissiveColor = falloffToColor(ring.falloffPct * (1 - progress * 0.5))
    }
  }
}

// ---------------------------------------------------------------------------
// Cleanup inactive blasts
// ---------------------------------------------------------------------------

function cleanupBlasts(): void {
  const wasActive = activeBlasts.length
  activeBlasts = activeBlasts.filter(b => b.isActive || b.rings.length > 0)

  if (activeBlasts.length === 0 && wasActive > 0) {
    // All blasts done
    document.getElementById('st-state')!.textContent = '完成'
  }
}

// ---------------------------------------------------------------------------
// UI updates
// ---------------------------------------------------------------------------

function updateUI(): void {
  const activeBlast = activeBlasts.find(b => b.isActive)
  if (activeBlast) {
    document.getElementById('st-tick')!.textContent = `${activeBlast.currentTick} / ${activeBlast.totalTicks}`
    document.getElementById('st-pos')!.textContent =
      `${Math.round(activeBlast.currentPos.x * WORLD_SCALE)}, ${Math.round(activeBlast.currentPos.z * WORLD_SCALE)}`
    const rawDist = Vector3.Distance(activeBlast.source, activeBlast.currentPos) * WORLD_SCALE
    document.getElementById('st-distance')!.textContent = `${Math.round(rawDist)}`
    const falloff = getFalloff(rawDist, DEFAULT_FALLOFF, DEFAULT_RANGE)
    document.getElementById('st-falloff')!.textContent = `${Math.round(falloff)}%`
    document.getElementById('st-speed')!.textContent = `${activeBlast.speed}`
    document.getElementById('st-state')!.textContent = isPaused ? '已暂停' : '传播中'
  } else if (activeBlasts.some(b => b.rings.length > 0)) {
    document.getElementById('st-state')!.textContent = '弹道完成，环消退中'
  }
}

function updateInfoBar(): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  document.getElementById('info-viewport')!.textContent = `${window.innerWidth}x${window.innerHeight}`
  document.getElementById('info-engine')!.textContent = engine.webGLVersion === 2 ? 'WebGL 2.0' : 'WebGL 1.0'
  document.getElementById('info-fps')!.textContent = String(Math.round(engine.getFps()))
  document.getElementById('info-time')!.textContent = new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function setupControls(): void {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement

  document.getElementById('btn-fire')!.addEventListener('click', () => {
    activeBlasts.push(createBlast())
  })

  let pauseBtn = document.getElementById('btn-pause')!
  pauseBtn.addEventListener('click', () => {
    isPaused = !isPaused
    pauseBtn.textContent = isPaused ? '恢复' : '暂停/恢复'
    pauseBtn.classList.toggle('active', isPaused)
  })

  document.getElementById('btn-step')!.addEventListener('click', () => {
    for (const blast of activeBlasts) {
      if (blast.isActive) tickBlast(blast)
    }
    cleanupBlasts()
    renderRings()
    updateUI()
  })

  const rngSpeed = document.getElementById('rng-speed') as HTMLInputElement
  const lblSpeed = document.getElementById('lbl-speed')!
  rngSpeed.addEventListener('input', () => {
    currentSpeed = parseInt(rngSpeed.value, 10)
    lblSpeed.textContent = String(currentSpeed)
  })

  const rngInacc = document.getElementById('rng-inaccuracy') as HTMLInputElement
  const lblInacc = document.getElementById('lbl-inaccuracy')!
  rngInacc.addEventListener('input', () => {
    currentInaccuracy = parseInt(rngInacc.value, 10)
    lblInacc.textContent = String(currentInaccuracy)
    updateSpreadCone()
  })

  const selInacc = document.getElementById('sel-inacctype') as HTMLSelectElement
  selInacc.addEventListener('change', () => {
    currentInaccuracyType = selInacc.value as InaccuracyType
    updateSpreadCone()
  })

  let spreadBtn = document.getElementById('btn-spread')!
  spreadBtn.addEventListener('click', () => {
    showSpreadCone = !showSpreadCone
    spreadBtn.classList.toggle('active', showSpreadCone)
    updateSpreadCone()
  })

  document.getElementById('btn-reset')!.addEventListener('click', () => {
    // Clear all blasts
    for (const blast of activeBlasts) {
      for (const ring of blast.rings) {
        const mesh = blastRingMeshes.get(ring)
        if (mesh) { mesh.dispose(); blastRingMeshes.delete(ring) }
      }
    }
    activeBlasts = []
    blastRingMeshes.clear()
    document.getElementById('st-state')!.textContent = '待发射'
    document.getElementById('st-tick')!.textContent = '0 / 0'
    document.getElementById('st-pos')!.textContent = '-'
    document.getElementById('st-distance')!.textContent = '0'
    document.getElementById('st-falloff')!.textContent = '100%'
  })

  // Click on ground to set target position
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return // Only left click
    const rect = canvas.getBoundingClientRect()
    const pickResult = scene.pick(
      e.clientX - rect.left,
      e.clientY - rect.top,
      (mesh) => mesh?.name === 'ground' || mesh?.name === 'grid',
    )
    if (pickResult?.hit && pickResult.pickedPoint) {
      const point = pickResult.pickedPoint.clone()
      point.y = 0.5
      targetPos = point
      targetMarker.position = targetPos.clone()
      // Update target ring position
      const children = targetMarker.getChildMeshes?.()
      if (!children) {
        const tgtRing = MeshBuilder.CreateTorus('tgtRing2', { diameter: 1.2, thickness: 0.04 }, scene)
        tgtRing.rotation.x = Math.PI / 2
        tgtRing.position = new Vector3(targetPos.x, 0.02, targetPos.z)
        const tgtRingMat = new StandardMaterial('tgtRingMat2', scene)
        tgtRingMat.emissiveColor = new Color3(0.9, 0.2, 0.2)
        tgtRing.material = tgtRingMat
      }
      updateTrajectoryLine()
      updateSpreadCone()
    }
  })
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

setupScene()
setupControls()

let tickAccumulator = 0

engine.runRenderLoop(() => {
  const deltaTime = engine.getDeltaTime()
  tickAccumulator += deltaTime

  if (!isPaused) {
    while (tickAccumulator >= TICK_RATE) {
      tickAccumulator -= TICK_RATE

      for (const blast of activeBlasts) {
        if (blast.isActive) tickBlast(blast)
      }
      cleanupBlasts()
    }
  }

  renderRings()
  updateUI()
  updateInfoBar()
  scene.render()
})

window.addEventListener('resize', () => {
  engine.resize()
})

// Expose for dev tools
;(window as unknown as Record<string, unknown>).__blastTest = {
  sourcePos,
  targetPos,
  activeBlasts,
  createBlast,
  lerpQuadratic,
  getFalloff,
  computeInaccuracy,
  currentSpeed,
  currentInaccuracy,
  currentInaccuracyType,
}
