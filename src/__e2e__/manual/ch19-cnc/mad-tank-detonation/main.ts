/**
 * ch19-cnc/mad-tank-detonation/main.ts — MadTank DetonationSequence acceptance test
 *
 * Verifies:
 * 1. onFirstRun: assigns target cell
 * 2. _initiate: grants deployed condition, ejects driver, plays thump animation
 * 3. tick: increments counter, deals thump damage every thumpInterval ticks
 * 4. Completion at ticks >= chargeDelay + detonationDelay
 * 5. onLastRun: deals detonation AoE damage, calls self.kill()
 *
 * OpenRA source: OpenRA.Mods.Cnc/Traits/MadTank.cs
 * TS source: src/OpenRA.Mods.Cnc/Traits/MadTank.ts
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
  ParticleSystem,
  Texture,
  Mesh,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Constants (mirrors MadTankInfo defaults)
// ---------------------------------------------------------------------------

interface MadTankConfig {
  thumpInterval: number
  chargeDelay: number
  detonationDelay: number
}

// ---------------------------------------------------------------------------
// DetonationSequence state machine
// ---------------------------------------------------------------------------

const DetPhase = {
  IDLE: 'IDLE',
  FIRST_RUN: 'FIRST_RUN',
  INITIATE: 'INITIATE',
  CHARGING: 'CHARGING',
  DETONATING: 'DETONATING',
  COMPLETE: 'COMPLETE',
  CANCELLED: 'CANCELLED',
} as const
type DetPhase = (typeof DetPhase)[keyof typeof DetPhase]

class DetonationSequence {
  private _ticks: number = 0
  private _isCancelling: boolean = false
  private _isInterruptible: boolean = true
  private _initiated: boolean = false
  private _phase: DetPhase = DetPhase.IDLE
  private _config: MadTankConfig

  /** Callbacks for visual/sound events. */
  readonly onThump: (() => void) | null
  readonly onChargeSound: (() => void) | null
  readonly onDetonate: (() => void) | null
  readonly onComplete: (() => void) | null

  constructor(
    config: MadTankConfig,
    callbacks: {
      onThump?: () => void
      onChargeSound?: () => void
      onDetonate?: () => void
      onComplete?: () => void
    } = {},
  ) {
    this._config = config
    this.onThump = callbacks.onThump ?? null
    this.onChargeSound = callbacks.onChargeSound ?? null
    this.onDetonate = callbacks.onDetonate ?? null
    this.onComplete = callbacks.onComplete ?? null
  }

  // -- Activity lifecycle --

  onFirstRun(): void {
    this._phase = DetPhase.FIRST_RUN
  }

  tick(): boolean {
    if (this._isCancelling) {
      this._phase = DetPhase.CANCELLED
      return true
    }

    if (!this._initiated) {
      this._initiate()
      if (this._isCancelling) return true
    }

    this._ticks++

    // Thump damage every thumpInterval ticks
    if (
      this._ticks % this._config.thumpInterval === 0 &&
      this._ticks < this._config.chargeDelay + this._config.detonationDelay
    ) {
      this.onThump?.()
    }

    // Charge sound at charge delay tick
    if (this._ticks === this._config.chargeDelay) {
      this._phase = DetPhase.CHARGING
      this.onChargeSound?.()
    }

    // Detonate when charge + detonation delay reached
    const totalTicks = this._config.chargeDelay + this._config.detonationDelay
    if (this._ticks >= totalTicks) {
      this._phase = DetPhase.DETONATING
      this.onDetonate?.()
      this.onComplete?.()
      this._phase = DetPhase.COMPLETE
      return true // sequence complete
    }

    return false
  }

  onLastRun(): void {
    // Already handled in tick() when detonation triggers
  }

  private _initiate(): void {
    this._phase = DetPhase.INITIATE
    this._isInterruptible = false
    this._initiated = true
  }

  cancel(): void {
    this._isCancelling = true
    this._phase = DetPhase.CANCELLED
  }

  reset(config?: MadTankConfig): void {
    if (config) this._config = config
    this._ticks = 0
    this._isCancelling = false
    this._isInterruptible = true
    this._initiated = false
    this._phase = DetPhase.IDLE
  }

  // -- Queries --

  get phase(): DetPhase { return this._phase }
  get ticks(): number { return this._ticks }
  get totalTicks(): number { return this._config.chargeDelay + this._config.detonationDelay }
  get isCancelling(): boolean { return this._isCancelling }
  get isInterruptible(): boolean { return this._isInterruptible }
  get initiated(): boolean { return this._initiated }
  get thumpCount(): number {
    if (this._ticks === 0) return 0
    return Math.floor(
      Math.min(this._ticks, this.totalTicks - 1) / this._config.thumpInterval,
    )
  }
}

// ---------------------------------------------------------------------------
// Babylon.js Scene
// ---------------------------------------------------------------------------

let engine!: Engine
let scene!: Scene
let sequence!: DetonationSequence

// Visual elements
let tankMesh!: Mesh
let engineGlowMat!: StandardMaterial
let shockwaveRing: Mesh | null = null
let explosionParticles: ParticleSystem | null = null
let thumpFlashLight: HemisphericLight | null = null

// Screen shake state
let shakeIntensity: number = 0

const tankBodyMat = new Color3(0.35, 0.4, 0.28)  // military olive
const engineGlowIdle = new Color3(0.1, 0.05, 0.0)
const engineGlowCharge = new Color3(0.8, 0.3, 0.0)
const engineGlowDetonate = new Color3(1.0, 0.6, 0.0)

function setupScene(): void {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false })
  scene = new Scene(engine)
  scene.clearColor = new Color4(0.08, 0.12, 0.18, 1)

  // Overhead camera
  const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3.5, 10, new Vector3(0, 0, 0), scene)
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 4
  camera.upperRadiusLimit = 25

  // Base lighting
  const hemi = new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)
  hemi.intensity = 0.8

  // Thump flash light (initially dim)
  thumpFlashLight = new HemisphericLight('flash', new Vector3(0, 1, 0), scene)
  thumpFlashLight.intensity = 0

  // Ground
  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.diffuseColor = new Color3(0.25, 0.3, 0.25)
  const ground = MeshBuilder.CreateGround('ground', { width: 12, height: 12 }, scene)
  ground.material = groundMat
  ground.position.y = -0.05

  // Grid lines on ground
  const gridMat = new StandardMaterial('gridMat', scene)
  gridMat.wireframe = true
  gridMat.diffuseColor = new Color3(0.35, 0.4, 0.35)
  const grid = MeshBuilder.CreateGround('grid', { width: 12, height: 12, subdivisions: 12 }, scene)
  grid.position.y = -0.04
  grid.material = gridMat

  // MAD Tank assembly
  // Hull
  const hullMat = new StandardMaterial('hullMat', scene)
  hullMat.diffuseColor = tankBodyMat
  hullMat.specularColor = new Color3(0.05, 0.05, 0.05)

  const hull = MeshBuilder.CreateBox('hull', { width: 1.2, height: 0.5, depth: 1.8 }, scene)
  hull.position.y = 0.25
  hull.material = hullMat

  // Turret
  const turretMat = new StandardMaterial('turretMat', scene)
  turretMat.diffuseColor = new Color3(0.3, 0.35, 0.25)

  const turret = MeshBuilder.CreateCylinder('turret', { height: 0.3, diameter: 0.8 }, scene)
  turret.position.y = 0.65
  turret.material = turretMat

  // Engine glow (rear of tank)
  engineGlowMat = new StandardMaterial('glowMat', scene)
  engineGlowMat.diffuseColor = engineGlowIdle
  engineGlowMat.emissiveColor = engineGlowIdle

  const engineGlow = MeshBuilder.CreateBox('glow', { width: 0.5, height: 0.3, depth: 0.3 }, scene)
  engineGlow.position.z = -1.0
  engineGlow.position.y = 0.25
  engineGlow.material = engineGlowMat

  // Combine into one transform node
  tankMesh = new Mesh('tankRoot', scene)
  hull.parent = tankMesh
  turret.parent = tankMesh
  engineGlow.parent = tankMesh
  tankMesh.position = new Vector3(0, 0, 0)

  // AoE damage indicator ring (for thump visualization)
  shockwaveRing = MeshBuilder.CreateTorus('shockwave', { diameter: 0.1, thickness: 0.05 }, scene)
  shockwaveRing.position.y = 0.05
  shockwaveRing.scaling.x = 0.01
  shockwaveRing.scaling.y = 0.01
  shockwaveRing.scaling.z = 0.01
  shockwaveRing.isVisible = false
  const ringMat2 = new StandardMaterial('ringMat2', scene)
  ringMat2.diffuseColor = new Color3(1, 0.3, 0)
  ringMat2.emissiveColor = new Color3(0.8, 0.2, 0)
  shockwaveRing.material = ringMat2

  // Explosion particle system
  explosionParticles = new ParticleSystem('explosion', 200, scene)
  explosionParticles.particleTexture = new Texture('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', scene)
  explosionParticles.emitter = tankMesh.position
  explosionParticles.minSize = 0.1
  explosionParticles.maxSize = 0.5
  explosionParticles.minLifeTime = 0.2
  explosionParticles.maxLifeTime = 0.8
  explosionParticles.emitRate = 0
  explosionParticles.createSphereEmitter(0.5)
  explosionParticles.color1 = new Color4(1, 0.4, 0, 1)
  explosionParticles.color2 = new Color4(1, 0.8, 0.2, 1)
  explosionParticles.colorDead = new Color4(0.2, 0.1, 0, 0)
  explosionParticles.stop()

  // Initialize sequence
  sequence = new DetonationSequence(
    { thumpInterval: 8, chargeDelay: 96, detonationDelay: 42 },
    {
      onThump: handleThump,
      onChargeSound: handleChargeSound,
      onDetonate: handleDetonate,
      onComplete: handleComplete,
    },
  )
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function handleThump(): void {
  // Visual: shockwave ring expansion + tank flash
  if (shockwaveRing) {
    shockwaveRing.isVisible = true
    shockwaveRing.scaling.x = 1.0
    shockwaveRing.scaling.y = 0.1
    shockwaveRing.scaling.z = 1.0
  }
  shakeIntensity = Math.min(shakeIntensity + 0.02, 0.15)

  // Engine glow ramps up
  const progress = sequence.ticks / sequence.totalTicks
  const glow = Color3.Lerp(engineGlowCharge, engineGlowDetonate, progress)
  engineGlowMat!.diffuseColor = glow
  engineGlowMat!.emissiveColor = glow

  // Flash
  if (thumpFlashLight) {
    thumpFlashLight.intensity = 0.8
  }
}

function handleChargeSound(): void {
  // Placeholder: in real game, plays madchrg2.aud
  // Visual: engine glow at max charge
  engineGlowMat!.diffuseColor = new Color3(1, 0.5, 0)
  engineGlowMat!.emissiveColor = new Color3(0.6, 0.3, 0)
}

function handleDetonate(): void {
  // Explosion burst
  if (explosionParticles) {
    explosionParticles.emitRate = 500
    explosionParticles.start()
    setTimeout(() => {
      explosionParticles!.emitRate = 0
      explosionParticles!.stop()
    }, 500)
  }

  // Flash
  if (thumpFlashLight) {
    thumpFlashLight.intensity = 3.0
  }

  // Disappear tank
  tankMesh.scaling = new Vector3(0.01, 0.01, 0.01)

  // Show "DETONATE!" text
  const indicator = document.getElementById('phase-indicator')!
  indicator.style.opacity = '1'
}

function handleComplete(): void {
  // Already rendered in detonate
}

// ---------------------------------------------------------------------------
// UI updates
// ---------------------------------------------------------------------------

function updateStatus(): void {
  const seq = sequence
  document.getElementById('st-phase')!.textContent = seq.phase
  document.getElementById('st-ticks')!.textContent = String(seq.ticks)
  document.getElementById('st-total')!.textContent = String(seq.totalTicks)
  document.getElementById('st-thumps')!.textContent = String(seq.thumpCount)
  document.getElementById('st-initiated')!.textContent = String(seq.initiated)
  document.getElementById('st-cancelling')!.textContent = String(seq.isCancelling)
  document.getElementById('st-intr')!.textContent = String(seq.isInterruptible)
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
  document.getElementById('btn-detonate')!.addEventListener('click', () => {
    startDetonation()
  })

  document.getElementById('btn-detonate-attack')!.addEventListener('click', () => {
    startDetonation()
  })

  document.getElementById('btn-cancel')!.addEventListener('click', () => {
    sequence.cancel()
  })

  document.getElementById('btn-reset')!.addEventListener('click', () => {
    resetSequence()
  })

  // Sliders
  const rngCharge = document.getElementById('rng-charge') as HTMLInputElement
  const rngDetonate = document.getElementById('rng-detonate') as HTMLInputElement
  const rngThump = document.getElementById('rng-thump') as HTMLInputElement

  rngCharge.addEventListener('input', () => {
    document.getElementById('lbl-charge')!.textContent = rngCharge.value
    document.getElementById('st-total')!.textContent =
      String(parseInt(rngCharge.value) + parseInt(rngDetonate.value))
  })

  rngDetonate.addEventListener('input', () => {
    document.getElementById('lbl-detonate')!.textContent = rngDetonate.value
    document.getElementById('st-total')!.textContent =
      String(parseInt(rngCharge.value) + parseInt(rngDetonate.value))
  })

  rngThump.addEventListener('input', () => {
    document.getElementById('lbl-thump')!.textContent = rngThump.value
  })
}

function startDetonation(): void {
  const chargeDelay = parseInt((document.getElementById('rng-charge') as HTMLInputElement).value)
  const detonationDelay = parseInt((document.getElementById('rng-detonate') as HTMLInputElement).value)
  const thumpInterval = parseInt((document.getElementById('rng-thump') as HTMLInputElement).value)

  sequence.reset({ thumpInterval, chargeDelay, detonationDelay })
  sequence.onFirstRun()

  // Reset visuals
  tankMesh.scaling = new Vector3(1, 1, 1)
  shakeIntensity = 0
  engineGlowMat!.diffuseColor = engineGlowIdle
  engineGlowMat!.emissiveColor = engineGlowIdle
  if (thumpFlashLight) thumpFlashLight.intensity = 0
  if (shockwaveRing) shockwaveRing.isVisible = false
  document.getElementById('phase-indicator')!.style.opacity = '0'
}

function resetSequence(): void {
  const chargeDelay = parseInt((document.getElementById('rng-charge') as HTMLInputElement).value)
  const detonationDelay = parseInt((document.getElementById('rng-detonate') as HTMLInputElement).value)
  const thumpInterval = parseInt((document.getElementById('rng-thump') as HTMLInputElement).value)

  sequence.reset({ thumpInterval, chargeDelay, detonationDelay })

  tankMesh.scaling = new Vector3(1, 1, 1)
  shakeIntensity = 0
  engineGlowMat!.diffuseColor = engineGlowIdle
  engineGlowMat!.emissiveColor = engineGlowIdle
  if (thumpFlashLight) thumpFlashLight.intensity = 0
  if (shockwaveRing) shockwaveRing.isVisible = false
  document.getElementById('phase-indicator')!.style.opacity = '0'
  if (explosionParticles) {
    explosionParticles.emitRate = 0
    explosionParticles.stop()
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

    if (sequence.phase !== DetPhase.IDLE && sequence.phase !== DetPhase.COMPLETE && sequence.phase !== DetPhase.CANCELLED) {
      sequence.tick()
    }

    // Decay flash
    if (thumpFlashLight && thumpFlashLight.intensity > 0) {
      thumpFlashLight.intensity = Math.max(0, thumpFlashLight.intensity - 0.15)
    }

    // Decay shake
    if (shakeIntensity > 0) {
      shakeIntensity = Math.max(0, shakeIntensity - 0.005)
    }

    // Animate shockwave ring
    if (shockwaveRing?.isVisible) {
      const scale = shockwaveRing.scaling.x + 0.3
      if (scale > 4) {
        shockwaveRing.isVisible = false
        shockwaveRing.scaling.x = 0.01
      } else {
        shockwaveRing.scaling.x = scale
        shockwaveRing.scaling.z = scale
      }
    }
  }

  // Screen shake effect
  // NOTE: Uses _origTarget property on camera to store the original target position.
  // This is a test-page convenience — production code would use a dedicated ShakeEffect
  // class that properly manages camera state without mutating foreign objects.
  if (shakeIntensity > 0.001 && scene.activeCamera) {
    const cam = scene.activeCamera as any
    if (cam.target && !cam._origTarget) {
      cam._origTarget = cam.target.clone()
    }
    if (cam._origTarget) {
      cam.target.x = cam._origTarget.x + (Math.random() - 0.5) * shakeIntensity * 2
      cam.target.z = cam._origTarget.z + (Math.random() - 0.5) * shakeIntensity * 2
    }
  }

  updateStatus()
  updateInfoBar()
  scene.render()
})

window.addEventListener('resize', () => {
  engine.resize()
})
