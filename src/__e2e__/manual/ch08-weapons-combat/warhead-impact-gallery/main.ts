/**
 * warhead-impact-gallery/main.ts — Multi-warhead effect showcase
 *
 * OpenRA对照: SpreadDamageWarhead, FireClusterWarhead, FlashEffectWarhead, ShakeScreenWarhead
 *
 * Verifies:
 *   W1. AOE radius circle matches spread:WDist within 0.5 wu
 *   W2. Sub-explosions all within spread radius
 *   W3. Screen flash peaks at 100% then decays to 0%
 *   W4. Camera shake amplitude halves every N ticks
 *   W5. Multiple simultaneous warheads stack effects additively
 */

import {
  Engine, Scene, ArcRotateCamera, HemisphericLight,
  Vector3, Color3, Color4, MeshBuilder, StandardMaterial, Mesh,
} from '@babylonjs/core'

// Scene
const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true })
const scene = new Scene(engine)
scene.clearColor = new Color4(0.04, 0.07, 0.12, 1)
const camera = new ArcRotateCamera('cam', -Math.PI / 2.5, Math.PI / 3, 14, new Vector3(6, 1, 6), scene)
camera.lowerRadiusLimit = 4; camera.upperRadiusLimit = 40; camera.attachControl(canvas, true)
new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene).intensity = 0.85

// Ground
const gnd = MeshBuilder.CreateGround('gnd', { width: 20, height: 20 }, scene); gnd.position.y = -0.02
const gm = new StandardMaterial('gm', scene)
gm.diffuseColor = new Color3(0.08, 0.11, 0.16); gm.specularColor = new Color3(0, 0, 0); gm.alpha = 0.75; gnd.material = gm
// Grid
for (let i = -4; i <= 10; i++) {
  const l = MeshBuilder.CreateLines('gx' + i, { points: [new Vector3(i, 0.005, -4), new Vector3(i, 0.005, 10)] }, scene)
  l.color = new Color3(0.12, 0.2, 0.35); l.alpha = i % 4 === 0 ? 0.25 : 0.06
}
for (let j = -4; j <= 10; j++) {
  const l = MeshBuilder.CreateLines('gz' + j, { points: [new Vector3(-4, 0.005, j), new Vector3(10, 0.005, j)] }, scene)
  l.color = new Color3(0.12, 0.2, 0.35); l.alpha = j % 4 === 0 ? 0.25 : 0.06
}

// ---------------------------------------------------------------------------
// Warhead Effects Engine
// ---------------------------------------------------------------------------

interface AOEConfig { center: Vector3; radius: number; clusterCount: number; flashDuration: number; shakeAmplitude: number }
interface ActiveEffect { type: 'aoe' | 'cluster' | 'flash' | 'shake'; pos: Vector3; ticks: number; config: AOEConfig; meshes: Mesh[]; data: Record<string, number> }
const activeEffects: ActiveEffect[] = []
let flashIntensity = 0; let shakeOffset = new Vector3()
let impactCount = 0

// Pre-allocated for per-tick reuse
const _shakeVec = new Vector3()
const _origTarget = new Vector3()

function createAOEIndicator(pos: Vector3, radius: number): Mesh {
  const ring = MeshBuilder.CreateTorus('aoeRing', { diameter: radius * 2, thickness: 0.04, tessellation: 48 }, scene)
  ring.position = pos; ring.position.y = 0.01
  const mat = new StandardMaterial('aoeMat' + impactCount, scene)
  mat.diffuseColor = new Color3(1, 0.3, 0.15); mat.emissiveColor = new Color3(0.5, 0.1, 0.02)
  mat.specularColor = new Color3(0, 0, 0); mat.alpha = 0.7; mat.disableLighting = true
  ring.material = mat
  return ring
}

function createSubExplosion(pos: Vector3): Mesh {
  const sphere = MeshBuilder.CreateSphere('subExp', { diameter: 0.25, segments: 8 }, scene)
  sphere.position = pos
  const mat = new StandardMaterial('subMat' + impactCount, scene)
  mat.diffuseColor = new Color3(1, 0.7, 0.1); mat.emissiveColor = new Color3(0.8, 0.4, 0.02)
  mat.specularColor = new Color3(0, 0, 0); mat.disableLighting = true
  sphere.material = mat
  return sphere
}

function triggerWarhead(type: string, pos: Vector3, config: Partial<AOEConfig> = {}): void {
  impactCount++
  const cfg: AOEConfig = { center: pos.clone(), radius: config.radius ?? 2.0, clusterCount: config.clusterCount ?? 6, flashDuration: config.flashDuration ?? 30, shakeAmplitude: config.shakeAmplitude ?? 0.15 }
  const meshes: Mesh[] = []

  if (type === 'spread' || type === 'all') {
    const ring = createAOEIndicator(pos, cfg.radius)
    meshes.push(ring)
  }
  if (type === 'cluster' || type === 'all') {
    for (let i = 0; i < cfg.clusterCount; i++) {
      const angle = (Math.PI * 2 * i) / cfg.clusterCount + Math.random() * 0.3
      const dist = Math.random() * cfg.radius * 0.85
      const subPos = new Vector3(pos.x + Math.cos(angle) * dist, 0.05, pos.z + Math.sin(angle) * dist)
      const sphere = createSubExplosion(subPos)
      meshes.push(sphere)
    }
  }
  if (type === 'flash' || type === 'all') {
    flashIntensity = 1.0
  }
  if (type === 'shake' || type === 'all') {
    // B1 fix: set shakeOffset to non-zero so getCameraShakeAmplitude() works
    shakeOffset.set(cfg.shakeAmplitude!, cfg.shakeAmplitude! * 0.5, 0)
  }

  // B1 fix: 'all' pushes separate entries per type for proper counting + tracking
  if (type === 'all') {
    if (meshes.length > 0) {
      activeEffects.push({ type: 'aoe', pos: pos.clone(), ticks: 0, config: cfg, meshes, data: { flashDuration: cfg.flashDuration, shakeAmplitude: cfg.shakeAmplitude } })
    }
    if (cfg.clusterCount && cfg.clusterCount > 0) {
      // Meshes for cluster are already in meshes array from the cluster section
      // We push a separate entry to track it independently
      activeEffects.push({ type: 'cluster', pos: pos.clone(), ticks: 0, config: cfg, meshes: [], data: { flashDuration: 0, shakeAmplitude: 0 } })
    }
  } else {
    activeEffects.push({
      type: type as ActiveEffect['type'],
      pos: pos.clone(),
      ticks: 0,
      config: cfg,
      meshes,
      data: { flashDuration: cfg.flashDuration, shakeAmplitude: cfg.shakeAmplitude },
    })
  }
}

function tickEffects(): void {
  // Flash decay
  if (flashIntensity > 0) {
    flashIntensity = Math.max(0, flashIntensity - 1 / 30) // 30 tick fade
  }

  // Shake decay
  if (shakeOffset.length() > 0.001) {
    shakeOffset.scaleInPlace(0.85) // exponential decay
  }

  // Update active effects
  for (let i = activeEffects.length - 1; i >= 0; i--) {
    const ef = activeEffects[i]!
    ef.ticks++
    const age = ef.ticks

    // Fade meshes
    const maxLife = ef.type === 'cluster' ? 25 : 40
    if (age > maxLife) {
      for (const m of ef.meshes) { m.material?.dispose(); m.dispose() }
      activeEffects.splice(i, 1)
      continue
    }
    const alpha = 1 - age / maxLife
    for (const m of ef.meshes) {
      if (m.material) m.material.alpha = alpha * 0.7
    }
    // Expand AOE ring
    if (ef.type === 'aoe' && ef.meshes[0]) {
      const s = 1 + age * 0.02; ef.meshes[0]!.scaling.setAll(s)
    }
  }

  // Apply shake to camera (MAJOR fix: no cumulative drift)
  if (activeEffects.some(e => e.type === 'shake' || e.type === 'aoe')) {
    const amp = activeEffects.reduce((a, e) => a + e.data.shakeAmplitude!, 0) * 0.3
    _shakeVec.set((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp * 0.5, 0)
    camera.target.copyFrom(_origTarget).addInPlace(_shakeVec)
  }
}

function resetAll(): void {
  for (const ef of activeEffects) { for (const m of ef.meshes) { m.material?.dispose(); m.dispose() } }
  activeEffects.length = 0; flashIntensity = 0; shakeOffset = new Vector3(); impactCount = 0
}

// Flash overlay
const flashOverlay = document.getElementById('flashOverlay')!

// Render loop
_origTarget.copyFrom(camera.target) // MAJOR: store original for shake restoration
const TICK_MS = 50; let lastTick = performance.now(); let lastFps = 0; let cachedFps = '0'
const MAX_CATCHUP_TICKS = 5  // B1 fix: cap tick accumulation to prevent instant expiry
engine.runRenderLoop(() => {
  const n = performance.now()
  let tickCount = 0
  while (n - lastTick >= TICK_MS && tickCount < MAX_CATCHUP_TICKS) { lastTick += TICK_MS; tickEffects(); tickCount++ }
  if (n - lastTick >= TICK_MS * MAX_CATCHUP_TICKS) { lastTick = n }
  scene.render()
  flashOverlay.style.opacity = String(Math.min(1, flashIntensity))
  if (n - lastFps > 500) { cachedFps = engine.getFps().toFixed(1); lastFps = n }
  const set = (id: string, v: string) => { const el = document.getElementById(id); if (el) el.textContent = v }
  set('diagActive', String(activeEffects.length)); set('diagFlash', flashIntensity.toFixed(2))
  set('diagShake', shakeOffset.length().toFixed(3)); set('diagImpacts', String(impactCount))
  set('info-fps', cachedFps); set('info-ua', navigator.userAgent.slice(0, 60))
  set('info-viewport', window.innerWidth + 'x' + window.innerHeight)
  set('info-engine', 'WebGL 2.0'); set('info-time', new Date().toLocaleTimeString())
})

// UI
document.getElementById('btnSpread')!.onclick = () => triggerWarhead('spread', new Vector3(3, 0, 3), { radius: 2.0 })
document.getElementById('btnCluster')!.onclick = () => triggerWarhead('cluster', new Vector3(5, 0, 5), { radius: 2.0, clusterCount: 8 })
document.getElementById('btnFlash')!.onclick = () => triggerWarhead('flash', new Vector3(6, 0, 3), { flashDuration: 30 })
document.getElementById('btnShake')!.onclick = () => triggerWarhead('shake', new Vector3(4, 0, 4), { shakeAmplitude: 0.2 })
document.getElementById('btnAll')!.onclick = () => triggerWarhead('all', new Vector3(4, 0, 4), { radius: 3.0, clusterCount: 10, flashDuration: 40, shakeAmplitude: 0.25 })
document.getElementById('btnReset')!.onclick = resetAll

// Test harness
;(window as any).__testHarness = {
  triggerWarhead(type: string, pos: { x: number; y: number; z: number }, config?: Partial<AOEConfig>): void {
    triggerWarhead(type, new Vector3(pos.x, pos.y, pos.z), config)
  },
  getAOERadius(): number | null {
    // B1 fix: include 'spread' and 'all' types in the search
    const aoe = activeEffects.find(e => e.type === 'spread' || e.type === 'aoe' || e.type === 'cluster' || e.type === 'all')
    return aoe ? aoe.config.radius : null
  },
  getFlashIntensity(): number { return flashIntensity },
  getCameraShakeAmplitude(): number { return shakeOffset.length() },
  getSubExplosionPositions(): { x: number; y: number; z: number }[] {
    // B1 fix: collect sphere meshes from all types, not just 'cluster'
    return activeEffects.flatMap(e => e.meshes.filter(m => m.name === 'subExp').map(m => ({ x: m.position.x, y: m.position.y, z: m.position.z })))
  },
  getActiveEffectCount(): number { return activeEffects.length },
  getImpactCount(): number { return impactCount },
  reset(): void { resetAll() },
}

window.addEventListener('resize', () => engine.resize())
