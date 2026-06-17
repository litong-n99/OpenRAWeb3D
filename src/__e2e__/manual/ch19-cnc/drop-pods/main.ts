/**
 * ch19-cnc/drop-pods/main.ts — Drop pod descent + ground impact acceptance test
 *
 * Verifies:
 * 1. Pod descent from sky (Y=6) to ground (Y=0) with particle trail
 * 2. Weapon impact timing after pod reaches ground (12 tick delay)
 * 3. Scatter pattern: pods distributed in a circle around target point
 * 4. Unit deployment: small indicator appears after impact
 * 5. Impact shockwave ring expansion
 *
 * OpenRA source: OpenRA.Mods.Cnc/Projectiles/DropPodImpact.cs (77 lines)
 * TS source: src/OpenRA.Mods.Cnc/Projectiles/DropPodImpact.ts
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
  ParticleSystem,
  Texture,
  TransformNode,
} from '@babylonjs/core'

const TICK_RATE = 1000 / 25
const IMPACT_DELAY = 12 // ticks
const DEPLOY_DELAY = 8  // ticks after impact
const POD_START_Y = 6.0

// ---------------------------------------------------------------------------
// Pod State
// ---------------------------------------------------------------------------

interface PodState {
  node: TransformNode
  body: Mesh
  trail: ParticleSystem | null
  shockwave: Mesh | null
  deployedUnit: Mesh | null
  impactParticles: ParticleSystem | null
  phase: 'DESCENDING' | 'IMPACTING' | 'DEPLOYED' | 'COMPLETE'
  height: number
  impactTimer: number
  deployTimer: number
  targetX: number
  targetZ: number
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

let engine!: Engine
let scene!: Scene
let activePods: PodState[] = []
let targetBaseX: number = 0
let targetBaseZ: number = -3

// ---------------------------------------------------------------------------
// Seeded random for scatter
// ---------------------------------------------------------------------------

function randomInCircle(radius: number, seed: number): { x: number; z: number } {
  const angle = ((seed * 127 + 13) % 10000) / 10000 * Math.PI * 2
  const dist = (((seed * 97 + 31) % 10000) / 10000) * radius
  return {
    x: Math.cos(angle) * dist,
    z: Math.sin(angle) * dist,
  }
}

// ---------------------------------------------------------------------------
// Scene Setup
// ---------------------------------------------------------------------------

function setupScene(): void {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
  scene = new Scene(engine)
  scene.clearColor = new Color4(0.04, 0.06, 0.12, 1)

  const camera = new ArcRotateCamera('camera', Math.PI / 4, Math.PI / 3, 15, new Vector3(0, 2, -3), scene)
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 5
  camera.upperRadiusLimit = 30

  const hemi = new HemisphericLight('hemi', new Vector3(0.3, 1, 0.1), scene)
  hemi.intensity = 0.5

  // Ground
  const gMat = new StandardMaterial('gMat', scene)
  gMat.diffuseColor = new Color3(0.15, 0.18, 0.2)
  const ground = MeshBuilder.CreateGround('ground', { width: 20, height: 20 }, scene)
  ground.material = gMat

  // Grid
  const gridMat = new StandardMaterial('gridMat', scene)
  gridMat.wireframe = true
  gridMat.diffuseColor = new Color3(0.25, 0.3, 0.35)
  const grid = MeshBuilder.CreateGround('grid', { width: 20, height: 20, subdivisions: 20 }, scene)
  grid.position.y = 0.005
  grid.material = gridMat

  // Target marker on ground
  const tMat = new StandardMaterial('tMat', scene)
  tMat.diffuseColor = new Color3(0.9, 0.6, 0.1)
  tMat.emissiveColor = new Color3(0.4, 0.2, 0.05)
  const targetCircle = MeshBuilder.CreateTorus('target', { diameter: 0.6, thickness: 0.04, tessellation: 32 }, scene)
  targetCircle.position = new Vector3(targetBaseX, 0.03, targetBaseZ)
  targetCircle.rotation.x = Math.PI / 2
  targetCircle.material = tMat
}

// ---------------------------------------------------------------------------
// Create Pod
// ---------------------------------------------------------------------------

function createPod(scatterX: number, scatterZ: number, podIndex: number): PodState {
  const node = new TransformNode(`pod_${podIndex}`, scene)
  node.position = new Vector3(scatterX, POD_START_Y, scatterZ)

  // Pod body (bullet-shaped capsule)
  const bodyMat = new StandardMaterial(`podMat_${podIndex}`, scene)
  bodyMat.diffuseColor = new Color3(0.5, 0.5, 0.55)
  bodyMat.specularColor = new Color3(0.3, 0.3, 0.4)
  const body = new Mesh(`podBody_${podIndex}`, scene)
  const capsule = MeshBuilder.CreateCapsule(`capsule_${podIndex}`, { height: 0.8, radius: 0.2 }, scene)
  capsule.material = bodyMat
  capsule.parent = body
  body.parent = node

  // Entry trail particle system
  const trail = new ParticleSystem(`trail_${podIndex}`, 30, scene)
  trail.particleTexture = new Texture('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', scene)
  trail.emitter = new Vector3(scatterX, POD_START_Y, scatterZ)
  trail.minEmitBox = new Vector3(-0.1, 0.5, -0.1)
  trail.maxEmitBox = new Vector3(0.1, 0.5, 0.1)
  trail.minSize = 0.02
  trail.maxSize = 0.1
  trail.minLifeTime = 0.1
  trail.maxLifeTime = 0.4
  trail.emitRate = 40
  trail.color1 = new Color4(1, 0.5, 0.1, 1)
  trail.color2 = new Color4(0.8, 0.3, 0.05, 1)
  trail.colorDead = new Color4(0.3, 0.1, 0, 0)
  trail.direction1 = new Vector3(0, 0.3, 0)
  trail.direction2 = new Vector3(0, 0.8, 0)
  trail.minEmitPower = 0.2
  trail.maxEmitPower = 0.5
  trail.start()

  return {
    node,
    body,
    trail,
    shockwave: null,
    deployedUnit: null,
    impactParticles: null,
    phase: 'DESCENDING',
    height: POD_START_Y,
    impactTimer: IMPACT_DELAY,
    deployTimer: DEPLOY_DELAY,
    targetX: scatterX,
    targetZ: scatterZ,
  }
}

// ---------------------------------------------------------------------------
// Create Impact Effect
// ---------------------------------------------------------------------------

function createImpactShockwave(pod: PodState, index: number): void {
  // Shockwave ring
  const swMat = new StandardMaterial(`swMat_${index}`, scene)
  swMat.diffuseColor = new Color3(1, 0.6, 0.2)
  swMat.emissiveColor = new Color3(0.5, 0.2, 0)
  swMat.alpha = 0.6
  const ring = MeshBuilder.CreateTorus(`shockwave_${index}`, { diameter: 0.1, thickness: 0.03, tessellation: 24 }, scene)
  ring.position = new Vector3(pod.targetX, 0.05, pod.targetZ)
  ring.rotation.x = Math.PI / 2
  ring.material = swMat
  pod.shockwave = ring

  // Ground impact particles
  const particles = new ParticleSystem(`impact_${index}`, 40, scene)
  particles.particleTexture = new Texture('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', scene)
  particles.emitter = new Vector3(pod.targetX, 0.1, pod.targetZ)
  particles.minEmitBox = new Vector3(-0.3, 0, -0.3)
  particles.maxEmitBox = new Vector3(0.3, 0.1, 0.3)
  particles.minSize = 0.03
  particles.maxSize = 0.15
  particles.minLifeTime = 0.2
  particles.maxLifeTime = 0.6
  particles.emitRate = 60
  particles.color1 = new Color4(1, 0.6, 0.2, 1)
  particles.color2 = new Color4(0.9, 0.7, 0.4, 1)
  particles.colorDead = new Color4(0.2, 0.1, 0.05, 0)
  particles.direction1 = new Vector3(-0.3, 0.5, -0.3)
  particles.direction2 = new Vector3(0.3, 1.5, 0.3)
  particles.minEmitPower = 0.5
  particles.maxEmitPower = 2
  particles.start()
  pod.impactParticles = particles
  // Auto-stop after 15 ticks
  setTimeout(() => particles.stop(), 600)
}

function createDeployedUnit(pod: PodState, index: number): void {
  const unitMat = new StandardMaterial(`unitMat_${index}`, scene)
  unitMat.diffuseColor = new Color3(0.2, 0.4, 0.9)
  unitMat.emissiveColor = new Color3(0.1, 0.2, 0.4)
  const unit = MeshBuilder.CreateBox(`unit_${index}`, { width: 0.3, height: 0.3, depth: 0.3 }, scene)
  unit.position = new Vector3(pod.targetX, 0.2, pod.targetZ)
  unit.material = unitMat
  pod.deployedUnit = unit
}

// ---------------------------------------------------------------------------
// Drop Pods
// ---------------------------------------------------------------------------

function dropPods(count: number): void {
  const scatter = parseInt((document.getElementById('rng-scatter') as HTMLInputElement).value)
  const scatterWorld = scatter / 1024

  for (let i = 0; i < count; i++) {
    const offset = randomInCircle(scatterWorld, Date.now() + i * 137)
    const pod = createPod(targetBaseX + offset.x, targetBaseZ + offset.z, Date.now() + i)
    activePods.push(pod)
  }
}

function clearAllPods(): void {
  for (const pod of activePods) {
    pod.body.dispose()
    pod.node.dispose()
    if (pod.trail) { pod.trail.stop(); pod.trail.dispose() }
    if (pod.shockwave) pod.shockwave.dispose()
    if (pod.deployedUnit) pod.deployedUnit.dispose()
    if (pod.impactParticles) { pod.impactParticles.stop(); pod.impactParticles.dispose() }
  }
  activePods = []
}

// ---------------------------------------------------------------------------
// UI Updates
// ---------------------------------------------------------------------------

function updateStatus(): void {
  const descending = activePods.filter(p => p.phase === 'DESCENDING').length
  const impacting = activePods.filter(p => p.phase === 'IMPACTING').length
  const deployed = activePods.filter(p => p.phase === 'DEPLOYED' || p.phase === 'COMPLETE').length

  let phaseStr = 'IDLE'
  if (activePods.length > 0) {
    if (descending > 0) phaseStr = 'DESCENDING'
    else if (impacting > 0) phaseStr = 'IMPACTING'
    else if (deployed === activePods.length) phaseStr = 'COMPLETE'
    else phaseStr = 'MIXED'
  }

  document.getElementById('st-phase')!.textContent = phaseStr
  document.getElementById('st-pods')!.textContent = String(activePods.length)
  document.getElementById('st-impacted')!.textContent = String(activePods.filter(p => p.phase !== 'DESCENDING').length)
  document.getElementById('st-deployed')!.textContent = String(deployed)
  document.getElementById('st-target')!.textContent = `${targetBaseX.toFixed(0)}, ${targetBaseZ.toFixed(0)}`
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
  document.getElementById('btn-drop')!.addEventListener('click', () => {
    const count = parseInt((document.getElementById('sel-count') as HTMLSelectElement).value)
    dropPods(count)
  })

  document.getElementById('btn-swarm')!.addEventListener('click', () => {
    dropPods(5)
  })

  document.getElementById('rng-scatter')!.addEventListener('input', function(this: HTMLInputElement) {
    document.getElementById('lbl-scatter')!.textContent = this.value
  })

  document.getElementById('btn-reset')!.addEventListener('click', () => {
    clearAllPods()
  })
}

// ---------------------------------------------------------------------------
// Main Loop
// ---------------------------------------------------------------------------

setupScene()
setupControls()

let tickAcc = 0
let speedFactor = 0.25

engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime()
  tickAcc += dt

  // Update speed from dropdown
  const speedSel = (document.getElementById('sel-speed') as HTMLSelectElement).value
  speedFactor = speedSel === 'fast' ? 1.0 : speedSel === 'slow' ? 0.1 : 0.25

  while (tickAcc >= TICK_RATE) {
    tickAcc -= TICK_RATE

    for (const pod of activePods) {
      switch (pod.phase) {
        case 'DESCENDING':
          pod.height = Math.max(0, pod.height - speedFactor)
          pod.node.position.y = pod.height
          // Update trail emitter position
          if (pod.trail) {
            pod.trail.emitter = pod.node.position.clone()
          }
          if (pod.height <= 0) {
            pod.phase = 'IMPACTING'
            if (pod.trail) { pod.trail.stop() }
          }
          break

        case 'IMPACTING':
          pod.impactTimer--
          if (pod.impactTimer <= 0) {
            createImpactShockwave(pod, activePods.indexOf(pod) + Date.now() % 1000)
            pod.phase = 'DEPLOYED'
          }
          break

        case 'DEPLOYED':
          pod.deployTimer--
          // Expand shockwave
          if (pod.shockwave) {
            const swMesh = pod.shockwave
            const progress = (DEPLOY_DELAY - pod.deployTimer) / DEPLOY_DELAY
            swMesh.scaling = new Vector3(1 + progress * 3, 1 + progress * 3, 1)
            const swMat = swMesh.material as StandardMaterial
            swMat.alpha = 0.6 * (1 - progress)
          }
          if (pod.deployTimer <= 0) {
            createDeployedUnit(pod, activePods.indexOf(pod) + Date.now() % 1000)
            if (pod.shockwave) { pod.shockwave.dispose(); pod.shockwave = null }
            pod.phase = 'COMPLETE'
          }
          break
      }
    }
  }

  updateStatus()
  updateInfoBar()
  scene.render()
})

window.addEventListener('resize', () => { engine.resize() })
