/**
 * explosion-effects/main.ts -- Explosion visual effects acceptance test
 *
 * OpenRA对照: OpenRA.Mods.Common/Effects/SpriteEffect.ts
 *            OpenRA.Mods.Common/Warheads/CreateEffectWarhead.ts
 *
 * Verifies:
 *   E1. Billboard explosion sprite (camera-facing) with expand-then-fade lifecycle
 *   E2. Debris particles (sphere + physics: gravity, bounce, friction, alpha decay)
 *   E3. Ground scorch marks (dark patches near impact point)
 *   E4. Water variant: blue ripple rings (Torus) expand+fade, no scorch
 *   E5. Two size presets: Large (peak 3.0 wu) / Small (peak 1.2 wu)
 *
 * 实现说明:
 *   - StandardMaterial with disableLighting=true + high emissive → OpenRA additive blend
 *   - Debris uses per-tick velocity integration (not Babylon ParticleSystem — more controllable)
 *   - All materials created per explosion + disposed on cleanup
 *   - Billboard mode: Mesh.BILLBOARDMODE_ALL for camera-facing
 */

import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  Vector3,
  Color3,
  Color4,
  MeshBuilder,
  StandardMaterial,
  Mesh,
  AbstractMesh,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Game logic tick interval: run 1 simulation tick every N render frames. */
const SIM_TICK_INTERVAL = 3

/** Gravity acceleration per tick (world units/tick²). ~9.4 wu/s² at 25 TPS. */
const GRAVITY_PER_TICK = 0.015

/** Surface ground Y coordinate (world units). */
const GROUND_Y = 0

/** Water surface Y coordinate (slightly below ground for water zone). */
const WATER_Y = -0.05

/** Size presets for explosion effects. */
interface ExplosionPreset {
  name: string
  /** Peak diameter of the billboard explosion in world units. */
  peakSize: number
  /** Duration of the EXPAND phase in game ticks. */
  expandDuration: number
  /** Duration of the FADE phase in game ticks. */
  fadeDuration: number
  /** Number of debris particles to spawn. */
  debrisCount: number
  /** Number of scorch marks to place (ground only; water variant ignores this). */
  scorchCount: number
  /** Billboard base color (RGB). */
  billboardColor: Color3
  /** Billboard emissive multiplier. */
  emissiveStrength: number
  /** Initial velocity range for debris (min, max in wu/tick). */
  debrisSpeedRange: [number, number]
  /** Debris sphere diameter range (min, max in wu). */
  debrisSizeRange: [number, number]
}

const PRESETS: Record<'large' | 'small', ExplosionPreset> = {
  large: {
    name: 'large',
    peakSize: 3.0,
    expandDuration: 24,
    fadeDuration: 12,
    debrisCount: 18,
    scorchCount: 4,
    billboardColor: new Color3(1.0, 0.55, 0.15),
    emissiveStrength: 2.0,
    debrisSpeedRange: [0.06, 0.18],
    debrisSizeRange: [0.06, 0.14],
  },
  small: {
    name: 'small',
    peakSize: 1.2,
    expandDuration: 16,
    fadeDuration: 8,
    debrisCount: 8,
    scorchCount: 4,
    billboardColor: new Color3(0.95, 0.5, 0.12),
    emissiveStrength: 1.6,
    debrisSpeedRange: [0.03, 0.10],
    debrisSizeRange: [0.04, 0.09],
  },
}

/** Water ripple ring count for water-variant explosions. */
const WATER_RIPPLE_COUNT = 3

/** Water ripple torus base color. */
const WATER_RIPPLE_COLOR = new Color3(0.2, 0.55, 0.95)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Explosion lifecycle phase. */
type ExplosionPhase = 'expand' | 'fade' | 'done'

/** A single debris particle (sphere mesh + physics state). */
interface DebrisParticle {
  mesh: Mesh
  velocity: Vector3
  totalLifetime: number
  remainingLifetime: number
  baseAlpha: number
}

/** A single water ripple ring (Torus mesh). */
interface RippleRing {
  mesh: Mesh
  spawnedAtTick: number
  maxRadius: number
  maxLifetime: number
  remainingLifetime: number
}

/** A single scorch mark on the ground. */
interface ScorchMark {
  mesh: Mesh
}

/** Complete state for one active explosion. */
interface ActiveExplosion {
  preset: ExplosionPreset
  isWater: boolean
  position: Vector3
  phase: ExplosionPhase
  tickCount: number
  billboard: Mesh
  billboardMat: StandardMaterial
  debris: DebrisParticle[]
  scorchMarks: ScorchMark[]
  rippleRings: RippleRing[]
}

// ---------------------------------------------------------------------------
// Babylon.js Scene Setup
// ---------------------------------------------------------------------------

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true })
const scene = new Scene(engine)
scene.clearColor = new Color4(0.06, 0.08, 0.12, 1)

const camera = new ArcRotateCamera(
  'cam',
  -Math.PI / 2.2,
  Math.PI / 3.8,
  18,
  new Vector3(3, 0, 3),
  scene,
)
camera.lowerRadiusLimit = 4
camera.upperRadiusLimit = 50
camera.attachControl(canvas, true)

const light = new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)
light.intensity = 0.9

// ---------------------------------------------------------------------------
// Ground Plane (main terrain)
// ---------------------------------------------------------------------------

const ground = MeshBuilder.CreateGround('ground', { width: 24, height: 24 }, scene)
ground.position.y = GROUND_Y - 0.02
const gmat = new StandardMaterial('gmat', scene)
gmat.diffuseColor = new Color3(0.18, 0.22, 0.15)
gmat.specularColor = new Color3(0, 0, 0)
gmat.alpha = 0.9
ground.material = gmat

// ---------------------------------------------------------------------------
// Grid lines for spatial reference
// ---------------------------------------------------------------------------

for (let i = -6; i <= 6; i++) {
  const line = MeshBuilder.CreateLines('gridX', {
    points: [new Vector3(i, 0.005, -6), new Vector3(i, 0.005, 6)],
  }, scene)
  line.color = new Color3(0.15, 0.25, 0.4)
  line.alpha = i % 3 === 0 ? 0.35 : 0.08
}
for (let j = -6; j <= 6; j++) {
  const line = MeshBuilder.CreateLines('gridZ', {
    points: [new Vector3(-6, 0.005, j), new Vector3(6, 0.005, j)],
  }, scene)
  line.color = new Color3(0.15, 0.25, 0.4)
  line.alpha = j % 3 === 0 ? 0.35 : 0.08
}

// ---------------------------------------------------------------------------
// Water Zone — blue semi-transparent plane in the -Z (north) area
// ---------------------------------------------------------------------------

const waterPlane = MeshBuilder.CreateGround('water', { width: 6, height: 6 }, scene)
waterPlane.position.set(0, WATER_Y, -5)
const wmat = new StandardMaterial('wmat', scene)
wmat.diffuseColor = new Color3(0.15, 0.3, 0.55)
wmat.emissiveColor = new Color3(0.05, 0.12, 0.25)
wmat.specularColor = new Color3(0.05, 0.1, 0.2)
wmat.alpha = 0.55
waterPlane.material = wmat

// Water boundary markers
const waterBoundaryPoints = [
  new Vector3(-3, 0.01, -2), new Vector3(3, 0.01, -2),
  new Vector3(3, 0.01, -2), new Vector3(3, 0.01, -8),
  new Vector3(3, 0.01, -8), new Vector3(-3, 0.01, -8),
  new Vector3(-3, 0.01, -8), new Vector3(-3, 0.01, -2),
]
const waterBoundary = MeshBuilder.CreateLines('waterBoundary', {
  points: waterBoundaryPoints,
}, scene)
waterBoundary.color = new Color3(0.2, 0.4, 0.7)
waterBoundary.alpha = 0.5

// ---------------------------------------------------------------------------
// Active Explosions State
// ---------------------------------------------------------------------------

const activeExplosions: ActiveExplosion[] = []

/** Scorch marks that persist after their parent explosion is cleaned up.
 *  Tracked separately so getScorchCells() continues to report them. */
const persistentScorchMarks: ScorchMark[] = []

// ---------------------------------------------------------------------------
// Material Factory — creates fresh materials per explosion (disposed on cleanup)
// ---------------------------------------------------------------------------

/**
 * Create a billboard explosion material with additive-blend simulation.
 * Uses `disableLighting=true` + high `emissiveColor` to mimic OpenRA's additive blend.
 * Colors are initialized to the preset defaults and mutated per-tick via `.set()`.
 */
function createBillboardMaterial(preset: ExplosionPreset, scene: Scene): StandardMaterial {
  const mat = new StandardMaterial(`billboard_${Date.now()}`, scene)
  mat.diffuseColor.set(preset.billboardColor.r, preset.billboardColor.g, preset.billboardColor.b)
  mat.emissiveColor.set(
    preset.billboardColor.r * preset.emissiveStrength,
    preset.billboardColor.g * preset.emissiveStrength,
    preset.billboardColor.b * preset.emissiveStrength,
  )
  mat.specularColor = new Color3(0, 0, 0)
  mat.disableLighting = true
  mat.alpha = 1.0
  mat.backFaceCulling = false
  return mat
}

/**
 * Create a debris particle material (dark grey-brown, unlit).
 * Each debris particle gets its own material instance so per-particle alpha
 * decay can be driven independently (StandardMaterial.alpha is material-level).
 */
function createDebrisMaterial(scene: Scene): StandardMaterial {
  const mat = new StandardMaterial(`debris_${Date.now()}`, scene)
  // Dark grey-brown for debris
  mat.diffuseColor = new Color3(0.25, 0.18, 0.10)
  mat.emissiveColor = new Color3(0.08, 0.05, 0.02)
  mat.specularColor = new Color3(0.02, 0.02, 0.02)
  mat.disableLighting = true
  mat.alpha = 1.0
  return mat
}

/**
 * Create a scorch mark material (near-black, semi-transparent, unlit).
 * Placed flat on the ground (rotation.x = π/2), no billboard mode.
 */
function createScorchMaterial(scene: Scene): StandardMaterial {
  const mat = new StandardMaterial(`scorch_${Date.now()}`, scene)
  mat.diffuseColor = new Color3(0.05, 0.04, 0.03)
  mat.emissiveColor = new Color3(0, 0, 0)
  mat.specularColor = new Color3(0, 0, 0)
  mat.disableLighting = true
  mat.alpha = 0.4
  mat.backFaceCulling = false
  return mat
}

/**
 * Create a water ripple ring material (blue, semi-transparent, unlit).
 * Alpha decays from 0.7→0 as the torus ring expands outward.
 */
function createRippleMaterial(scene: Scene): StandardMaterial {
  const mat = new StandardMaterial(`ripple_${Date.now()}`, scene)
  mat.diffuseColor = WATER_RIPPLE_COLOR.clone()
  mat.emissiveColor = new Color3(0.1, 0.3, 0.5)
  mat.specularColor = new Color3(0.05, 0.1, 0.2)
  mat.disableLighting = true
  mat.alpha = 0.7
  mat.backFaceCulling = false
  return mat
}

// ---------------------------------------------------------------------------
// Explosion Creation
// ---------------------------------------------------------------------------

/**
 * Create a billboard explosion disc at the given position.
 * The disc starts at diameter=0.05 and scales to peakSize over expandDuration.
 */
function createBillboard(position: Vector3, preset: ExplosionPreset): { mesh: Mesh; mat: StandardMaterial } {
  const mesh = MeshBuilder.CreateDisc(
    `billboard_${Date.now()}`,
    { radius: 0.5, tessellation: 32 },
    scene,
  )
  mesh.position = position.clone()
  mesh.position.y += 0.05 // Slight offset above ground
  mesh.billboardMode = AbstractMesh.BILLBOARDMODE_ALL
  mesh.scaling.setAll(0.05 / 1.0) // Start tiny (0.05 diameter = 0.05 * 1.0 disc)

  const mat = createBillboardMaterial(preset, scene)
  mesh.material = mat

  return { mesh, mat }
}

/**
 * Spawn debris particles from the explosion center.
 * Each debris particle is a small sphere with random outward velocity.
 */
function spawnDebris(
  position: Vector3,
  preset: ExplosionPreset,
  scene: Scene,
): DebrisParticle[] {
  const particles: DebrisParticle[] = []
  const [speedMin, speedMax] = preset.debrisSpeedRange
  const [sizeMin, sizeMax] = preset.debrisSizeRange

  for (let i = 0; i < preset.debrisCount; i++) {
    // Random direction (hemisphere upward bias)
    const azimuth = Math.random() * Math.PI * 2
    const elevation = Math.random() * Math.PI * 0.45 // 0 to ~80 deg from horizontal
    const speed = speedMin + Math.random() * (speedMax - speedMin)

    const vx = Math.cos(azimuth) * Math.cos(elevation) * speed
    const vy = Math.sin(elevation) * speed
    const vz = Math.sin(azimuth) * Math.cos(elevation) * speed

    const size = sizeMin + Math.random() * (sizeMax - sizeMin)
    const mesh = MeshBuilder.CreateSphere(
      `debris_${Date.now()}_${i}`,
      { diameter: size, segments: 4 },
      scene,
    )
    mesh.position = position.clone()
    mesh.position.y += 0.08 // Start slightly above ground

    // Individual material per particle: each debris decays alpha independently,
    // and Babylon.js StandardMaterial.alpha is a material-level property.
    // A shared material would cause all particles to fade in lockstep.
    const mat = createDebrisMaterial(scene)
    mesh.material = mat

    const lifetime = 35 + Math.random() * 25 // 35-60 ticks
    particles.push({
      mesh,
      velocity: new Vector3(vx, vy, vz),
      totalLifetime: lifetime,
      remainingLifetime: lifetime,
      baseAlpha: 0.7 + Math.random() * 0.3,
    })
  }

  return particles
}

/**
 * Create scorch marks on the ground near the impact position.
 * Small dark discs placed at random offsets around the impact point.
 */
function createScorchMarks(position: Vector3, preset: ExplosionPreset, scene: Scene): ScorchMark[] {
  const marks: ScorchMark[] = []

  for (let i = 0; i < preset.scorchCount; i++) {
    // Random offset within ~1.5 wu of impact
    const angle = Math.random() * Math.PI * 2
    const distance = 0.2 + Math.random() * 1.5
    const ox = Math.cos(angle) * distance
    const oz = Math.sin(angle) * distance

    const scorchSize = 0.15 + Math.random() * 0.35
    const mesh = MeshBuilder.CreateDisc(
      `scorch_${Date.now()}_${i}`,
      { radius: scorchSize, tessellation: 8 },
      scene,
    )
    mesh.position.set(position.x + ox, GROUND_Y + 0.002, position.z + oz)
    mesh.rotation.x = Math.PI / 2 // Flat on ground
    mesh.billboardMode = 0 // No billboard — stays flat on ground

    const mat = createScorchMaterial(scene)
    mesh.material = mat

    marks.push({ mesh })
  }

  return marks
}

/**
 * Create water ripple rings (Torus meshes) for water-variant explosions.
 * Rings start small, expand outward, and fade out.
 */
function createRippleRings(position: Vector3, scene: Scene): RippleRing[] {
  const rings: RippleRing[] = []

  for (let i = 0; i < WATER_RIPPLE_COUNT; i++) {
    const mesh = MeshBuilder.CreateTorus(
      `ripple_${Date.now()}_${i}`,
      {
        diameter: 0.2,
        thickness: 0.03,
        tessellation: 48,
      },
      scene,
    )
    mesh.position.set(position.x, WATER_Y + 0.01, position.z)
    mesh.rotation.x = Math.PI / 2 // Flat on water surface

    const mat = createRippleMaterial(scene)
    mesh.material = mat

    const staggerDelay = i * 4 // Stagger start by 4 ticks each
    const maxRadius = 1.8 + i * 0.8
    const lifetime = 20 + i * 5

    rings.push({
      mesh,
      spawnedAtTick: staggerDelay,
      maxRadius,
      maxLifetime: lifetime,
      remainingLifetime: lifetime,
    })
  }

  return rings
}

/**
 * Main function to trigger an explosion at the given position.
 * Creates billboard + debris + scorch marks (or water ripples for water variant).
 */
function triggerExplosion(
  position: Vector3,
  size: 'large' | 'small' = 'large',
  isWater: boolean = false,
): void {
  const preset = PRESETS[size]
  const pos = position.clone()

  // Adjust Y for water variant
  if (isWater) {
    pos.y = WATER_Y
  }

  // Create billboard
  const { mesh: billboard, mat: billboardMat } = createBillboard(pos, preset)

  // Spawn debris
  const debris = spawnDebris(pos, preset, scene)

  // Scorch marks (ground only) or ripple rings (water only)
  let scorchMarks: ScorchMark[] = []
  let rippleRings: RippleRing[] = []

  if (isWater) {
    rippleRings = createRippleRings(pos, scene)
  } else {
    scorchMarks = createScorchMarks(pos, preset, scene)
  }

  const explosion: ActiveExplosion = {
    preset,
    isWater,
    position: pos,
    phase: 'expand',
    tickCount: 0,
    billboard,
    billboardMat,
    debris,
    scorchMarks,
    rippleRings,
  }

  activeExplosions.push(explosion)
  updateDiagnostics()
}

// ---------------------------------------------------------------------------
// Simulation Tick — advances all active explosions by one game tick
// ---------------------------------------------------------------------------

/**
 * Advance all active explosions by one game logic tick.
 * Called every SIM_TICK_INTERVAL render frames from the render loop.
 * Iterates in reverse so concurrent removal is safe.
 */
function simulateTick(): void {
  if (activeExplosions.length === 0) return

  for (let ei = activeExplosions.length - 1; ei >= 0; ei--) {
    const exp = activeExplosions[ei]!
    exp.tickCount++

    // --- Billboard expand-then-fade lifecycle ---
    updateBillboard(exp)

    // --- Debris physics ---
    updateDebris(exp)

    // --- Ripple rings (water variant) ---
    if (exp.isWater) {
      updateRipples(exp)
    }

    // --- Check if explosion is fully done ---
    checkDone(exp, ei)
  }

  updateDiagnostics()
}

/**
 * Update billboard: EXPAND phase scales up, FADE phase reduces alpha.
 */
function updateBillboard(exp: ActiveExplosion): void {
  const { preset, tickCount } = exp

  if (exp.phase === 'expand') {
    // Scale from 0.05 → peakSize over expandDuration
    const progress = Math.min(1, tickCount / preset.expandDuration)
    // Use ease-out for natural expansion feel
    const easedProgress = 1 - (1 - progress) * (1 - progress)
    const currentSize = 0.05 + (preset.peakSize - 0.05) * easedProgress
    exp.billboard.scaling.setAll(currentSize)

    // Color shifts from white-hot to orange during expand
    const t = progress
    exp.billboardMat.diffuseColor.set(
      1.0,
      0.55 + 0.45 * t,
      0.15 + 0.35 * t,
    )
    exp.billboardMat.emissiveColor.set(
      0.8 * (1 - t * 0.5),
      0.35 * (1 - t * 0.6),
      0.05 * (1 - t * 0.5),
    )
    exp.billboardMat.alpha = 1.0

    // Transition to fade
    if (tickCount >= preset.expandDuration) {
      exp.phase = 'fade'
      exp.tickCount = 0 // Reset tick counter for fade phase
    }
  } else if (exp.phase === 'fade') {
    // Fade alpha from 1 → 0 over fadeDuration
    const fadeProgress = Math.min(1, tickCount / preset.fadeDuration)
    exp.billboardMat.alpha = 1.0 - fadeProgress

    // Keep size at peak during fade
    exp.billboard.scaling.setAll(preset.peakSize)

    // Reduce emissive during fade
    exp.billboardMat.emissiveColor.set(
      0.4 * (1 - fadeProgress),
      0.15 * (1 - fadeProgress),
      0.02 * (1 - fadeProgress),
    )

    if (tickCount >= preset.fadeDuration) {
      exp.phase = 'done'
    }
  }
}

/**
 * Update debris particles: apply gravity, integrate velocity, handle ground bounce, decay alpha.
 */
function updateDebris(exp: ActiveExplosion): void {
  for (let di = exp.debris.length - 1; di >= 0; di--) {
    const p = exp.debris[di]!
    p.remainingLifetime--

    if (p.remainingLifetime <= 0) {
      // Dispose dead debris
      p.mesh.material?.dispose()
      p.mesh.dispose()
      exp.debris.splice(di, 1)
      continue
    }

    // Apply gravity
    p.velocity.y -= GRAVITY_PER_TICK

    // Integrate position
    p.mesh.position.x += p.velocity.x
    p.mesh.position.y += p.velocity.y
    p.mesh.position.z += p.velocity.z

    // Ground collision with bounce
    if (p.mesh.position.y <= GROUND_Y) {
      p.mesh.position.y = GROUND_Y
      if (p.velocity.y < 0) {
        // Bounce with restitution ~0.35
        p.velocity.y = Math.abs(p.velocity.y) * 0.35
        // Friction on x/z: reduce by 50%
        p.velocity.x *= 0.5
        p.velocity.z *= 0.5

        // Stop bouncing if velocity is very small
        if (Math.abs(p.velocity.y) < 0.003) {
          p.velocity.y = 0
          p.velocity.x *= 0.3
          p.velocity.z *= 0.3
        }
      }
    }

    // Alpha decay: linear from baseAlpha to 0 over lifetime
    const lifeRatio = p.remainingLifetime / p.totalLifetime
    const material = p.mesh.material as StandardMaterial | null
    if (material) {
      material.alpha = p.baseAlpha * lifeRatio
    }

    // Scale down slightly as it decays (simulates burning out)
    const scaleFactor = 0.3 + 0.7 * lifeRatio
    p.mesh.scaling.setAll(scaleFactor)
  }
}

/**
 * Update water ripple rings: expand radius and fade alpha.
 */
function updateRipples(exp: ActiveExplosion): void {
  for (let ri = exp.rippleRings.length - 1; ri >= 0; ri--) {
    const ring = exp.rippleRings[ri]!
    ring.remainingLifetime--

    // Don't start expanding until stagger delay has passed
    if (exp.phase === 'expand' && ring.spawnedAtTick > 0) {
      // Use the billboard expand tick count for ripple stagger
      // Ripple ticks are tracked separately; spawnedAtTick counts down
      ring.spawnedAtTick--
      continue
    }

    if (ring.remainingLifetime <= 0) {
      ring.mesh.material?.dispose()
      ring.mesh.dispose()
      exp.rippleRings.splice(ri, 1)
      continue
    }

    // Expand radius
    const lifeRatio = 1 - (ring.remainingLifetime / ring.maxLifetime)
    const currentRadius = 0.1 + (ring.maxRadius - 0.1) * lifeRatio
    // Torus diameter parameter update — we need to rebuild or scale
    // Scale approach: initial torus had diameter 0.2, target is maxRadius*2
    const scale = currentRadius / 0.1
    ring.mesh.scaling.setAll(scale)

    // Fade alpha
    const material = ring.mesh.material as StandardMaterial | null
    if (material) {
      const fadeProgress = 1 - lifeRatio
      material.alpha = 0.7 * fadeProgress
    }
  }
}

/**
 * Check if an explosion is fully done and clean it up.
 */
function checkDone(exp: ActiveExplosion, index: number): void {
  if (exp.phase !== 'done') return
  if (exp.debris.length > 0) return
  if (exp.rippleRings.length > 0) return

  // Dispose billboard
  exp.billboardMat.dispose()
  exp.billboard.dispose()

  // Move scorch marks to persistent tracking (they stay visible on ground until reset)
  for (const s of exp.scorchMarks) {
    persistentScorchMarks.push(s)
  }
  exp.scorchMarks.length = 0

  // Remove from active list
  activeExplosions.splice(index, 1)
}

// ---------------------------------------------------------------------------
// Reset — clear all explosions and scorch marks
// ---------------------------------------------------------------------------

/**
 * Reset the entire scene: dispose and remove all active explosions,
 * debris, scorch marks (including persistent), and ripple rings.
 * After calling this, the scene is clean with zero visible effects.
 */
function resetAll(): void {
  for (const exp of activeExplosions) {
    // Dispose billboard
    exp.billboardMat.dispose()
    exp.billboard.dispose()

    // Dispose debris
    for (const p of exp.debris) {
      p.mesh.material?.dispose()
      p.mesh.dispose()
    }

    // Dispose scorch marks
    for (const s of exp.scorchMarks) {
      s.mesh.material?.dispose()
      s.mesh.dispose()
    }

    // Dispose ripple rings
    for (const r of exp.rippleRings) {
      r.mesh.material?.dispose()
      r.mesh.dispose()
    }
  }
  // Dispose persistent scorch marks
  for (const s of persistentScorchMarks) {
    s.mesh.material?.dispose()
    s.mesh.dispose()
  }
  persistentScorchMarks.length = 0

  activeExplosions.length = 0
  updateDiagnostics()
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/**
 * Refresh the sidebar diagnostics panel with current explosion state.
 * Reports aggregate counts across all active (and persistent) effects.
 */
function updateDiagnostics(): void {
  const totalDebris = activeExplosions.reduce((sum, e) => sum + e.debris.length, 0)
  const activeScorch = activeExplosions.reduce((sum, e) => sum + e.scorchMarks.length, 0)
  const totalScorch = activeScorch + persistentScorchMarks.length
  const totalRipples = activeExplosions.reduce((sum, e) => sum + e.rippleRings.length, 0)

  document.getElementById('diag-active')!.textContent = String(activeExplosions.length)
  document.getElementById('diag-total')!.textContent = String(totalDebris)
  document.getElementById('diag-scorch')!.textContent = String(totalScorch)
  document.getElementById('diag-ripples')!.textContent = String(totalRipples)

  if (activeExplosions.length > 0) {
    const last = activeExplosions[activeExplosions.length - 1]!
    document.getElementById('diag-phase')!.textContent = last.phase
    document.getElementById('diag-preset')!.textContent = last.preset.name
    document.getElementById('diag-water')!.textContent = last.isWater ? 'YES' : 'no'
    document.getElementById('diag-pos')!.textContent =
      `(${last.position.x.toFixed(2)}, ${last.position.y.toFixed(2)}, ${last.position.z.toFixed(2)})`
    document.getElementById('diag-ticks')!.textContent = String(last.tickCount)
    document.getElementById('diag-progress')!.textContent =
      `${(getExplosionProgress(last) * 100).toFixed(0)}%`
    document.getElementById('diag-facing')!.textContent =
      isBillboardFacingCamera(last) ? 'YES (>0.95)' : 'NO'
  } else {
    document.getElementById('diag-phase')!.textContent = 'none'
    document.getElementById('diag-preset')!.textContent = 'none'
    document.getElementById('diag-water')!.textContent = '-'
    document.getElementById('diag-pos')!.textContent = '-'
    document.getElementById('diag-ticks')!.textContent = '-'
    document.getElementById('diag-progress')!.textContent = '-'
    document.getElementById('diag-facing')!.textContent = '-'
  }
}

/**
 * Compute normalised progress [0-1] of an explosion's lifecycle.
 * EXPAND phase maps to [0, 0.5], FADE phase to [0.5, 1.0], DONE = 1.0.
 */
function getExplosionProgress(exp: ActiveExplosion): number {
  if (exp.phase === 'done') return 1.0
  const totalDuration = exp.preset.expandDuration + exp.preset.fadeDuration
  if (exp.phase === 'expand') {
    return (exp.tickCount / totalDuration) * 0.5 // 0-0.5 during expand
  }
  // Fade phase: 0.5-1.0
  return 0.5 + (exp.tickCount / exp.preset.fadeDuration) * 0.5
}

/**
 * Verify the billboard mesh is facing the active camera.
 * Transforms the mesh's local forward vector to world space and computes
 * the dot product against the camera-to-billboard direction.
 * @returns true if |dot| > 0.95 (angle < ~18°)
 */
function isBillboardFacingCamera(exp: ActiveExplosion): boolean {
  // Get the billboard's world forward direction
  const billboardForward = Vector3.Forward()
  // In Babylon.js, billboard mode rotates the mesh so its "up" faces the camera.
  // Actually BILLBOARDMODE_ALL makes the mesh face the camera on all axes.
  // The mesh's world forward (original Z) should point toward the camera.
  const worldMatrix = exp.billboard.getWorldMatrix()
  const forward = Vector3.TransformNormal(billboardForward, worldMatrix)
  forward.normalize()

  // Vector from billboard to camera
  const toCamera = camera.position.subtract(exp.billboard.position)
  toCamera.normalize()

  // Dot product: 1.0 = perfectly facing, 0 = perpendicular
  const dot = Math.abs(Vector3.Dot(forward, toCamera))
  return dot > 0.95
}

// ---------------------------------------------------------------------------
// Render Loop
// ---------------------------------------------------------------------------

let frameCounter = 0

engine.runRenderLoop(() => {
  frameCounter++
  if (frameCounter >= SIM_TICK_INTERVAL) {
    frameCounter = 0
    simulateTick()
  }

  scene.render()
  updateInfoBar()
})

// ---------------------------------------------------------------------------
// Info Bar
// ---------------------------------------------------------------------------

let lastInfoTimeUpdate = 0
let cachedInfoTime = ''

/**
 * Refresh the bottom info bar: UA, viewport, WebGL version, FPS, timestamp.
 * Timestamp is throttled to update at most once per second.
 */
function updateInfoBar(): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  document.getElementById('info-viewport')!.textContent =
    `${window.innerWidth}x${window.innerHeight} (canvas: ${canvas.width}x${canvas.height})`
  document.getElementById('info-engine')!.textContent =
    engine.webGLVersion === 2 ? 'WebGL 2.0' : 'WebGL 1.0'
  document.getElementById('info-fps')!.textContent = String(Math.round(engine.getFps()))

  const now = Date.now()
  if (now - lastInfoTimeUpdate > 1000) {
    cachedInfoTime = new Date().toISOString()
    lastInfoTimeUpdate = now
  }
  document.getElementById('info-time')!.textContent = cachedInfoTime
}

window.addEventListener('resize', () => { engine.resize() })

// ---------------------------------------------------------------------------
// Button Handlers
// ---------------------------------------------------------------------------

const presetSelect = document.getElementById('preset-select') as HTMLSelectElement
const posXInput = document.getElementById('pos-x') as HTMLInputElement
const posZInput = document.getElementById('pos-z') as HTMLInputElement

function getTargetPosition(): Vector3 {
  const x = parseFloat(posXInput.value) || 0
  const z = parseFloat(posZInput.value) || 0
  return new Vector3(x, GROUND_Y, z)
}

document.getElementById('btn-ground')!.addEventListener('click', () => {
  const pos = getTargetPosition()
  const size = presetSelect.value as 'large' | 'small'
  triggerExplosion(pos, size, false)
})

document.getElementById('btn-water')!.addEventListener('click', () => {
  // Water explosion always at the water zone position
  const pos = new Vector3(
    parseFloat(posXInput.value) || 0,
    WATER_Y,
    -5, // Center of water zone
  )
  const size = presetSelect.value as 'large' | 'small'
  triggerExplosion(pos, size, true)
})

document.getElementById('btn-reset')!.addEventListener('click', () => {
  resetAll()
})

// Quick-position buttons
document.getElementById('btn-pos-center')!.addEventListener('click', () => {
  posXInput.value = '0'
  posZInput.value = '0'
})

document.getElementById('btn-pos-north')!.addEventListener('click', () => {
  posXInput.value = '0'
  posZInput.value = '-5'
})

document.getElementById('btn-pos-east')!.addEventListener('click', () => {
  posXInput.value = '3'
  posZInput.value = '0'
})

// ---------------------------------------------------------------------------
// Test Harness — exposed on window for Playwright programmatic verification
// ---------------------------------------------------------------------------

;(window as any).__testHarness = {
  scene,
  engine,

  /**
   * Trigger an explosion at the given position.
   * @param pos - Position in Babylon world coordinates (defaults to origin)
   * @param size - 'large' or 'small' preset (defaults to 'large')
   * @param water - Whether this is a water-variant explosion (defaults to false)
   */
  triggerExplosion(
    pos?: { x: number; y: number; z: number },
    size?: 'large' | 'small',
    water?: boolean,
  ): void {
    const p = pos
      ? new Vector3(pos.x, pos.y ?? GROUND_Y, pos.z)
      : new Vector3(0, GROUND_Y, 0)
    triggerExplosion(p, size ?? 'large', water ?? false)
  },

  /**
   * Convenience method: trigger a water-variant explosion.
   * @param pos - Position in Babylon world coordinates
   */
  triggerWaterExplosion(pos?: { x: number; y: number; z: number }): void {
    const p = pos
      ? new Vector3(pos.x, pos.y ?? WATER_Y, pos.z)
      : new Vector3(0, WATER_Y, -5)
    triggerExplosion(p, 'large', true)
  },

  /**
   * Get total number of active debris particles across all explosions.
   */
  getParticleCount(): number {
    return activeExplosions.reduce((sum, e) => sum + e.debris.length, 0)
  },

  /**
   * Get total number of scorch marks across all explosions.
   */
  getScorchCells(): number {
    const activeScorch = activeExplosions.reduce((sum, e) => sum + e.scorchMarks.length, 0)
    return activeScorch + persistentScorchMarks.length
  },

  /**
   * Get explosion progress [0-1] of the most recent explosion.
   * Returns 0 if no explosion is active.
   */
  getExplosionProgress(): number {
    if (activeExplosions.length === 0) return 0
    return getExplosionProgress(activeExplosions[activeExplosions.length - 1]!)
  },

  /**
   * Get the phase of the most recent explosion.
   * Returns 'none' if no explosion is active.
   */
  getExplosionPhase(): string {
    if (activeExplosions.length === 0) return 'none'
    return activeExplosions[activeExplosions.length - 1]!.phase
  },

  /**
   * Check if the most recent explosion's billboard is facing the camera.
   * Returns false if no explosion is active.
   */
  isBillboardFacingCamera(): boolean {
    if (activeExplosions.length === 0) return false
    return isBillboardFacingCamera(activeExplosions[activeExplosions.length - 1]!)
  },

  /**
   * Check if the most recent explosion is a water variant.
   * Returns false if no explosion is active.
   */
  isWaterVariant(): boolean {
    if (activeExplosions.length === 0) return false
    return activeExplosions[activeExplosions.length - 1]!.isWater
  },

  /**
   * Get the active preset name of the most recent explosion.
   * Returns 'none' if no explosion is active.
   */
  getActivePreset(): string {
    if (activeExplosions.length === 0) return 'none'
    return activeExplosions[activeExplosions.length - 1]!.preset.name
  },

  /** Reset all explosions and clear the scene. */
  reset: resetAll,

  /** Get the total number of active explosions. */
  getActiveExplosionCount(): number {
    return activeExplosions.length
  },
}
