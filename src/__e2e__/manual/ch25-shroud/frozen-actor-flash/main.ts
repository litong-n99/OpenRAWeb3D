/**
 * ch25-shroud/frozen-actor-flash/main.ts — FrozenActor Flash 3D Acceptance Test
 *
 * Verifies the FrozenActor.Flash() 3D tint effect on Babylon.js meshes:
 * 1. ReplaceColor: emissiveColor set directly to tint, alpha overridden
 * 2. Multiplicative: emissiveColor = original * tint (component-wise)
 * 3. Blink pattern: ON for even remaining ticks, OFF for odd
 * 4. Expiry: emissiveColor and alpha revert exactly to pre-flash values
 * 5. Re-trigger: new Flash captures current emissive as new baseline
 *
 * This is a self-contained simulation — it does NOT import from FrozenActorLayer.
 * The flash state machine exactly mirrors FrozenActor.Flash() / _applyFlashTint()
 * / _revertFlashTint() / Tick() behaviour.
 *
 * OpenRA 对照: src/OpenRA.Game/Traits/Player/FrozenActorLayer.ts (lines 322–1031)
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
  type Mesh,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Flash State Manager (mirrors FrozenActor flash state machine)
// ---------------------------------------------------------------------------

/**
 * Per-mesh flash state, exactly mirroring FrozenActor's private flash fields.
 *
 * OpenRA 对照: FrozenActor._flashTicks, _flashTint, _flashAlpha,
 *   _flashModifiers, _savedEmissive
 */
interface FlashState {
  /** Remaining flash ticks (decremented each tick). 0 = expired. */
  flashTicks: number
  /** RGB flash tint (normalized 0-1). */
  flashTint: { r: number; g: number; b: number }
  /** Optional alpha override. null = no alpha modification. */
  flashAlpha: number | null
  /**
   * Tint modifier flags.
   * 1 = TintModifiers.ReplaceColor (emissive = tint directly)
   * 0 = TintModifiers.None (emissive = original * tint component-wise)
   */
  flashModifiers: number
  /**
   * Snapshot of the material's original emissiveColor, captured on the
   * first ON cycle. Used to restore emissive during OFF cycles and to
   * provide a stable base for multiplicative tinting.
   * null when not flashing, or after flash expiry.
   */
  savedEmissive: { r: number; g: number; b: number } | null
  /** Original alpha captured on first ON cycle. */
  savedAlpha: number
}

/** Reference to the mesh and its material. */
interface MeshBinding {
  mesh: Mesh
  material: StandardMaterial
  /** The original emissiveColor (set at construction, never changes). */
  originalEmissive: { r: number; g: number; b: number }
  /** Flash state for this mesh. */
  flash: FlashState
}

function createFlashState(): FlashState {
  return {
    flashTicks: 0,
    flashTint: { r: 0, g: 0, b: 0 },
    flashAlpha: null,
    flashModifiers: 0,
    savedEmissive: null,
    savedAlpha: 1.0,
  }
}

/**
 * Check if the flash is currently rendering ON.
 * OpenRA 对照: FrozenActor.isFlashing — `flashTicks > 0 && flashTicks % 2 == 0`
 */
function isFlashing(state: FlashState): boolean {
  return state.flashTicks > 0 && state.flashTicks % 2 === 0
}

/**
 * Trigger a Flash() on a mesh.
 * OpenRA 对照: FrozenActor.Flash(Color, float) and FrozenActor.Flash(float3)
 */
function triggerFlash(
  binding: MeshBinding,
  tint: { r: number; g: number; b: number },
  alpha: number | undefined,
  modifiers: number,
): void {
  const state = binding.flash
  // Reset saved emissive so the next ON cycle re-captures from current state
  state.savedEmissive = null
  state.savedAlpha = 1.0
  state.flashTicks = 5
  state.flashModifiers = modifiers

  if (alpha !== undefined) {
    // Flash(Color, float alpha) — ReplaceColor mode
    // C# Color values are 0-255, divide by 255 for normalized range
    state.flashTint = {
      r: tint.r / 255,
      g: tint.g / 255,
      b: tint.b / 255,
    }
    state.flashAlpha = alpha
  } else {
    // Flash(float3 tint) — Multiplicative mode
    // Tint values are already normalized 0-1
    state.flashTint = { r: tint.r, g: tint.g, b: tint.b }
    state.flashAlpha = null
  }
}

/**
 * Apply flash tint to the material.
 * OpenRA 对照: FrozenActor._applyFlashTint()
 */
function applyFlashTint(binding: MeshBinding): void {
  const state = binding.flash
  const mat = binding.material
  const tint = state.flashTint
  const isReplaceColor = state.flashModifiers === 1
  const isInitialApply = state.savedEmissive === null

  // Snapshot the original emissive on the first ON cycle
  if (isInitialApply) {
    const emissive = mat.emissiveColor
    state.savedEmissive = { r: emissive.r, g: emissive.g, b: emissive.b }
    state.savedAlpha = mat.alpha
  }

  if (isReplaceColor) {
    // ReplaceColor: set emissive directly to tint color
    mat.emissiveColor = new Color3(tint.r, tint.g, tint.b)
  } else {
    // Multiplicative tint: multiply the SAVED original by tint
    // (not the current value, which may have been zeroed by _revertFlashTint)
    const saved = state.savedEmissive!
    mat.emissiveColor = new Color3(
      saved.r * tint.r,
      saved.g * tint.g,
      saved.b * tint.b,
    )
  }

  if (state.flashAlpha !== null) {
    mat.alpha = state.flashAlpha
  }
}

/**
 * Revert flash tint on the material.
 * OpenRA 对照: FrozenActor._revertFlashTint()
 */
function revertFlashTint(binding: MeshBinding): void {
  const state = binding.flash
  const mat = binding.material

  // Restore original emissive (or black if none was captured)
  const restoreColor = state.savedEmissive ?? { r: 0, g: 0, b: 0 }
  mat.emissiveColor = new Color3(restoreColor.r, restoreColor.g, restoreColor.b)

  // Only revert alpha if we actually modified it during apply.
  // Unconditionally setting alpha=1 would corrupt a mesh's custom alpha
  // when Flash(float3) (no alpha) was used.
  if (state.flashAlpha !== null) {
    mat.alpha = state.savedAlpha
  }
}

/**
 * Execute one tick for a mesh's flash state.
 * OpenRA 对照: FrozenActor.Tick() flash processing
 */
function tickFlash(binding: MeshBinding): void {
  const state = binding.flash

  if (state.flashTicks > 0) {
    state.flashTicks--

    if (isFlashing(state)) {
      // Even ticks — apply flash tint (blink ON)
      applyFlashTint(binding)
    } else {
      // Odd ticks or zero — revert flash tint (blink OFF)
      revertFlashTint(binding)
    }
  }

  // When flash fully expires, clear saved emissive so next Flash()
  // captures a fresh original
  if (state.flashTicks === 0 && state.savedEmissive !== null) {
    state.savedEmissive = null
  }
}

// ---------------------------------------------------------------------------
// Babylon.js Scene Setup
// ---------------------------------------------------------------------------

function setupScene(): {
  engine: Engine
  scene: Scene
  bindings: MeshBinding[]
} {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: false,
    antialias: true,
  })
  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.08, 0.10, 0.14, 1.0)

  // Camera — elevated perspective looking at the center actor area
  const camera = new ArcRotateCamera(
    'camera',
    -Math.PI / 3,   // alpha: orbit angle
    Math.PI / 4,    // beta: 45° elevation
    14,             // radius
    new Vector3(0, 0.5, 0),
    scene,
  )
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 4
  camera.upperRadiusLimit = 40
  camera.panningSensibility = 50

  // Lighting — ambient + directional for subtle shading on the ground
  new HemisphericLight('hemi', new Vector3(0.3, 1, 0.2), scene)

  // -------------------------------------------------------------------------
  // Ground Plane — dark gray (representing fogged terrain)
  // -------------------------------------------------------------------------

  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.diffuseColor = new Color3(0.12, 0.13, 0.16)
  groundMat.specularColor = new Color3(0.02, 0.02, 0.02)
  groundMat.backFaceCulling = false

  const ground = MeshBuilder.CreateGround(
    'ground',
    { width: 20, height: 20, subdivisions: 1 },
    scene,
  )
  ground.position = new Vector3(0, -0.05, 0)
  ground.material = groundMat
  ground.receiveShadows = false

  // -------------------------------------------------------------------------
  // Create 3 "frozen actor" meshes at different positions
  // Each has a distinct base emissive color
  // -------------------------------------------------------------------------

  const bindings: MeshBinding[] = []

  /**
   * Helper: create a box mesh representing a frozen actor.
   *
   * Frozen actors in OpenRA appear as slightly translucent snapshot copies
   * of the live actor. Here we use simple colored boxes to focus on the
   * flash tint behavior.
   */
  function createFrozenActor(
    name: string,
    position: Vector3,
    baseEmissive: { r: number; g: number; b: number },
    baseDiffuse: Color3,
    baseAlpha: number,
  ): MeshBinding {
    const mat = new StandardMaterial(`mat_${name}`, scene)
    mat.diffuseColor = baseDiffuse
    mat.emissiveColor = new Color3(baseEmissive.r, baseEmissive.g, baseEmissive.b)
    mat.alpha = baseAlpha
    mat.specularColor = new Color3(0.05, 0.05, 0.05)
    mat.backFaceCulling = false

    const mesh = MeshBuilder.CreateBox(name, { width: 1.2, height: 1.2, depth: 1.2 }, scene)
    mesh.position = position
    mesh.material = mat

    const binding: MeshBinding = {
      mesh,
      material: mat,
      originalEmissive: { ...baseEmissive },
      flash: createFlashState(),
    }
    bindings.push(binding)
    return binding
  }

  // Mesh #1: Red-tinged base — left
  createFrozenActor(
    'frozen_red',
    new Vector3(-3, 0.6, 0),
    { r: 0.30, g: 0.10, b: 0.10 },
    new Color3(0.25, 0.12, 0.12),
    1.0,
  )

  // Mesh #2: Blue-tinged base — center
  createFrozenActor(
    'frozen_blue',
    new Vector3(0, 0.6, 0),
    { r: 0.10, g: 0.10, b: 0.30 },
    new Color3(0.12, 0.12, 0.25),
    1.0,
  )

  // Mesh #3: Green-tinged base — right
  createFrozenActor(
    'frozen_green',
    new Vector3(3, 0.6, 0),
    { r: 0.10, g: 0.30, b: 0.10 },
    new Color3(0.12, 0.25, 0.12),
    1.0,
  )

  // -------------------------------------------------------------------------
  // Coordinate reference markers on the ground (small colored squares)
  // -------------------------------------------------------------------------

  function createGroundMarker(
    name: string,
    position: Vector3,
    color: Color3,
  ): void {
    const markerMat = new StandardMaterial(`marker_${name}`, scene)
    markerMat.emissiveColor = color
    markerMat.diffuseColor = Color3.Black()
    markerMat.specularColor = Color3.Black()
    markerMat.disableLighting = true
    markerMat.backFaceCulling = false

    const marker = MeshBuilder.CreateGround(name, { width: 0.5, height: 0.5 }, scene)
    marker.position = position
    marker.material = markerMat
  }

  createGroundMarker('marker_red', new Vector3(-3, 0.01, 0), new Color3(0.3, 0.05, 0.05))
  createGroundMarker('marker_blue', new Vector3(0, 0.01, 0), new Color3(0.05, 0.05, 0.3))
  createGroundMarker('marker_green', new Vector3(3, 0.01, 0), new Color3(0.05, 0.3, 0.05))

  return { engine, scene, bindings }
}

// ---------------------------------------------------------------------------
// UI Status Update
// ---------------------------------------------------------------------------

function makeColorPreview(r: number, g: number, b: number): string {
  const rr = Math.round(Math.max(0, Math.min(1, r)) * 255)
  const gg = Math.round(Math.max(0, Math.min(1, g)) * 255)
  const bb = Math.round(Math.max(0, Math.min(1, b)) * 255)
  return `rgb(${rr},${gg},${bb})`
}

function fmtEmissive(r: number, g: number, b: number): string {
  return `(${r.toFixed(2)}, ${g.toFixed(2)}, ${b.toFixed(2)})`
}

function updateStatusDisplay(bindings: MeshBinding[]): void {
  for (let i = 0; i < 3; i++) {
    const idx = i + 1
    const b = bindings[i]
    const state = b.flash
    const mat = b.material

    // Tick badge
    const badge = document.getElementById(`badge-${idx}`)!
    const tick = document.getElementById(`tick-${idx}`)!

    if (state.flashTicks === 0) {
      badge.textContent = 'EXPIRED'
      badge.className = 'tick-badge expired'
    } else if (isFlashing(state)) {
      badge.textContent = 'ON'
      badge.className = 'tick-badge on'
    } else {
      badge.textContent = 'OFF'
      badge.className = 'tick-badge off'
    }
    tick.textContent = String(state.flashTicks)

    // Emissive color
    const emissive = mat.emissiveColor
    const swatch = document.getElementById(`swatch-${idx}`)!
    const emissiveEl = document.getElementById(`emissive-${idx}`)!
    swatch.style.background = makeColorPreview(emissive.r, emissive.g, emissive.b)
    emissiveEl.textContent = fmtEmissive(emissive.r, emissive.g, emissive.b)

    // Alpha
    const alphaEl = document.getElementById(`alpha-${idx}`)!
    alphaEl.textContent = mat.alpha.toFixed(2)

    // Mode
    const modeEl = document.getElementById(`mode-${idx}`)!
    if (state.flashTicks === 0) {
      modeEl.textContent = '—'
    } else if (state.flashModifiers === 1) {
      modeEl.textContent = 'ReplaceColor'
    } else {
      modeEl.textContent = 'Multiplicative'
    }
  }
}

function updateInfoBar(engine: Engine): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  document.getElementById('info-viewport')!.textContent = `${window.innerWidth}x${window.innerHeight}`
  document.getElementById('info-engine')!.textContent = engine.webGLVersion === 2 ? 'WebGL 2.0' : 'WebGL 1.0'
  document.getElementById('info-fps')!.textContent = String(Math.round(engine.getFps()))
  document.getElementById('info-time')!.textContent = new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Flash Trigger Helpers
// ---------------------------------------------------------------------------

/**
 * Trigger ReplaceColor flash (Color + alpha overload).
 * OpenRA 对照: Flash(new Color(r, g, b), alpha)
 */
function flashReplaceColor(
  binding: MeshBinding,
  color: { r: number; g: number; b: number },
  alpha: number,
): void {
  triggerFlash(binding, color, alpha, 1 /* TintModifiers.ReplaceColor */)
}

/**
 * Trigger Multiplicative flash (float3 tint overload).
 * OpenRA 对照: Flash(new float3(r, g, b))
 */
function flashMultiplicative(
  binding: MeshBinding,
  tint: { r: number; g: number; b: number },
): void {
  triggerFlash(binding, tint, undefined, 0 /* TintModifiers.None */)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { engine, scene, bindings } = setupScene()

// Global tick counter for display
let globalTick = 0

// Tick interval: 1000ms so each tick is visually observable
const TICK_INTERVAL_MS = 1000

const tickInterval = setInterval(() => {
  globalTick++
  document.getElementById('global-tick')!.textContent = String(globalTick)

  // Tick flash for each mesh
  for (const b of bindings) {
    tickFlash(b)
  }

  updateStatusDisplay(bindings)
}, TICK_INTERVAL_MS)

// ---------------------------------------------------------------------------
// UI Controls
// ---------------------------------------------------------------------------

document.getElementById('btn-flash-red')!.addEventListener('click', () => {
  // Flash(Color(255, 0, 0), 0.7f) → ReplaceColor red with alpha 0.7
  flashReplaceColor(bindings[0], { r: 255, g: 0, b: 0 }, 0.7)
  updateStatusDisplay(bindings)
})

document.getElementById('btn-flash-blue')!.addEventListener('click', () => {
  // Flash(new float3(0.2f, 0.2f, 1.0f)) → Multiplicative blue tint
  flashMultiplicative(bindings[1], { r: 0.2, g: 0.2, b: 1.0 })
  updateStatusDisplay(bindings)
})

document.getElementById('btn-flash-green')!.addEventListener('click', () => {
  // Flash(new float3(0.2f, 1.0f, 0.2f)) → Multiplicative green tint
  flashMultiplicative(bindings[2], { r: 0.2, g: 1.0, b: 0.2 })
  updateStatusDisplay(bindings)
})

document.getElementById('btn-flash-all')!.addEventListener('click', () => {
  flashReplaceColor(bindings[0], { r: 255, g: 0, b: 0 }, 0.7)
  flashMultiplicative(bindings[1], { r: 0.2, g: 0.2, b: 1.0 })
  flashMultiplicative(bindings[2], { r: 0.2, g: 1.0, b: 0.2 })
  updateStatusDisplay(bindings)
})

// ---------------------------------------------------------------------------
// Render Loop + Info Bar
// ---------------------------------------------------------------------------

engine.runRenderLoop(() => {
  scene.render()
  updateInfoBar(engine)
})

window.addEventListener('resize', () => {
  engine.resize()
})

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  clearInterval(tickInterval)
  engine.dispose()
})

// Expose for test harness / dev tools
;(window as unknown as Record<string, unknown>).__frozenActorFlashTest = {
  bindings,
  engine,
  scene,
  flashReplaceColor,
  flashMultiplicative,
  isFlashing,
  getGlobalTick: () => globalTick,
}
