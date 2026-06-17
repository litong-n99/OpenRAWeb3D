/**
 * ch19-cnc/ion-cannon/main.ts — Ion cannon orbital beam + ground splash acceptance test
 *
 * Verifies:
 * 1. Descending beam timing: cylinder from sky (Y=8) to ground (Y=0)
 * 2. Weapon impact: fires after weaponDelay ticks from beam reaching ground
 * 3. Ground splash particle effect: burst on impact
 * 4. Animation completion: beam disposed, particles fade, effect removed
 *
 * OpenRA source: OpenRA.Mods.Cnc/Projectiles/IonCannon.cs (73 lines)
 * TS source: src/OpenRA.Mods.Cnc/Projectiles/IonCannon.ts
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
  PointLight,
} from '@babylonjs/core'

const TICK_RATE = 1000 / 25

// ---------------------------------------------------------------------------
// Scene State
// ---------------------------------------------------------------------------

let engine!: Engine
let scene!: Scene
let beamMesh: Mesh | null = null
let beamLight: PointLight | null = null
let groundSplash: ParticleSystem | null = null
let targetMarker: Mesh

// Animation state
let phase: 'IDLE' | 'DESCENDING' | 'IMPACTING' | 'COMPLETE' = 'IDLE'
let beamHeight: number = 8.0
let weaponDelay: number = 15
let impacted: boolean = false
let destroyed: boolean = false
let descentSpeed: number = 0.5
let splashTimer: number = 0
const SPLASH_DURATION = 20 // ticks

// ---------------------------------------------------------------------------
// Scene Setup
// ---------------------------------------------------------------------------

function setupScene(): void {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
  scene = new Scene(engine)
  // Darker scene to make the beam pop
  scene.clearColor = new Color4(0.02, 0.03, 0.06, 1)

  const camera = new ArcRotateCamera('camera', Math.PI / 4, Math.PI / 3, 14, new Vector3(0, 4, 0), scene)
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 5
  camera.upperRadiusLimit = 30

  // Dim lighting for contrast with beam
  const hemi = new HemisphericLight('hemi', new Vector3(0.3, 1, 0.1), scene)
  hemi.intensity = 0.3

  // Ground
  const groundMat = new StandardMaterial('gMat', scene)
  groundMat.diffuseColor = new Color3(0.15, 0.2, 0.15)
  const ground = MeshBuilder.CreateGround('ground', { width: 20, height: 20 }, scene)
  ground.material = groundMat

  // Target marker (red circle on ground)
  const tMat = new StandardMaterial('tMat', scene)
  tMat.diffuseColor = new Color3(0.9, 0.2, 0.1)
  tMat.emissiveColor = new Color3(0.5, 0.1, 0.05)
  tMat.alpha = 0.7
  targetMarker = MeshBuilder.CreateTorus('target', { diameter: 1.2, thickness: 0.05, tessellation: 32 }, scene)
  targetMarker.position = new Vector3(2, 0.03, -1)
  targetMarker.rotation.x = Math.PI / 2
  targetMarker.material = tMat

  // Second inner ring
  const innerRing = MeshBuilder.CreateTorus('inner', { diameter: 0.4, thickness: 0.04, tessellation: 24 }, scene)
  innerRing.position = new Vector3(2, 0.04, -1)
  innerRing.rotation.x = Math.PI / 2
  innerRing.material = tMat
}

// ---------------------------------------------------------------------------
// Fire Ion Cannon
// ---------------------------------------------------------------------------

function fireIonCannon(): void {
  // Clean up previous
  cleanupBeam()

  phase = 'DESCENDING'
  beamHeight = 8.0
  weaponDelay = parseInt((document.getElementById('rng-delay') as HTMLInputElement).value)
  impacted = false
  destroyed = false

  const speedSel = (document.getElementById('sel-speed') as HTMLSelectElement).value
  descentSpeed = speedSel === 'fast' ? 2.0 : speedSel === 'slow' ? 0.2 : 0.5

  // Create beam cylinder
  const beamMat = new StandardMaterial('beamMat', scene)
  beamMat.diffuseColor = new Color3(0.1, 0.4, 0.9)
  beamMat.emissiveColor = new Color3(0.3, 0.6, 1.0)
  beamMat.alpha = 0.6
  beamMat.specularColor = new Color3(0, 0, 0)

  beamMesh = MeshBuilder.CreateCylinder('beam', {
    height: beamHeight,
    diameterTop: 0.4,
    diameterBottom: 0.8,
    tessellation: 16,
  }, scene)
  beamMesh.material = beamMat
  beamMesh.position = new Vector3(2, beamHeight / 2, -1)

  // Point light for illumination
  beamLight = new PointLight('beamLight', new Vector3(2, 1, -1), scene)
  beamLight.diffuse = new Color3(0.2, 0.5, 1.0)
  beamLight.intensity = 0
}

function cleanupBeam(): void {
  if (beamMesh) { beamMesh.dispose(); beamMesh = null }
  if (beamLight) { beamLight.dispose(); beamLight = null }
  if (groundSplash) { groundSplash.stop(); groundSplash.dispose(); groundSplash = null }
}

function triggerSplash(): void {
  // Ground splash particle system
  groundSplash = new ParticleSystem('splash', 60, scene)
  groundSplash.particleTexture = new Texture('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', scene)
  groundSplash.emitter = new Vector3(2, 0.1, -1)
  groundSplash.minEmitBox = new Vector3(-0.5, 0, -0.5)
  groundSplash.maxEmitBox = new Vector3(0.5, 0.1, 0.5)
  groundSplash.minSize = 0.05
  groundSplash.maxSize = 0.3
  groundSplash.minLifeTime = 0.3
  groundSplash.maxLifeTime = 0.8
  groundSplash.emitRate = 80
  groundSplash.color1 = new Color4(0.3, 0.5, 1.0, 1)
  groundSplash.color2 = new Color4(0.6, 0.8, 1.0, 1)
  groundSplash.colorDead = new Color4(0.1, 0.1, 0.3, 0)
  groundSplash.direction1 = new Vector3(-0.3, 1, -0.3)
  groundSplash.direction2 = new Vector3(0.3, 2, 0.3)
  groundSplash.minEmitPower = 1
  groundSplash.maxEmitPower = 3
  groundSplash.start()
  splashTimer = SPLASH_DURATION
}

// ---------------------------------------------------------------------------
// UI Updates
// ---------------------------------------------------------------------------

function updateStatus(): void {
  document.getElementById('st-phase')!.textContent = phase
  document.getElementById('st-height')!.textContent = beamHeight.toFixed(2)
  document.getElementById('st-delay')!.textContent = String(weaponDelay)
  document.getElementById('st-impacted')!.textContent = String(impacted)
  document.getElementById('st-particles')!.textContent = groundSplash && groundSplash.isStarted() ? 'active' : '0'
  document.getElementById('st-destroyed')!.textContent = String(destroyed)
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
  document.getElementById('btn-fire')!.addEventListener('click', () => fireIonCannon())

  document.getElementById('btn-multi')!.addEventListener('click', () => {
    fireIonCannon()
    setTimeout(() => fireIonCannon(), 2000)
    setTimeout(() => fireIonCannon(), 4000)
  })

  document.getElementById('rng-delay')!.addEventListener('input', function(this: HTMLInputElement) {
    document.getElementById('lbl-delay')!.textContent = this.value
  })

  document.getElementById('btn-reset')!.addEventListener('click', () => {
    cleanupBeam()
    phase = 'IDLE'
    beamHeight = 8.0
    impacted = false
    destroyed = false
    splashTimer = 0
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

    switch (phase) {
      case 'DESCENDING':
        // Beam descends
        beamHeight = Math.max(0, beamHeight - descentSpeed)
        if (beamMesh) {
          beamMesh.scaling.y = beamHeight / 8.0
          beamMesh.position.y = beamHeight / 2
        }
        // Light intensifies as beam nears ground
        if (beamLight) {
          beamLight.intensity = (1 - beamHeight / 8.0) * 3.0
        }
        // Beam reached ground
        if (beamHeight <= 0) {
          phase = 'IMPACTING'
        }
        break

      case 'IMPACTING':
        weaponDelay--
        if (weaponDelay <= 0 && !impacted) {
          impacted = true
          // Trigger ground splash + screen flash
          triggerSplash()
          if (beamLight) beamLight.intensity = 5.0
        }
        // Flash light fade
        if (impacted && beamLight) {
          beamLight.intensity = Math.max(0, beamLight.intensity - 0.3)
        }
        // Particle lifespan countdown
        if (impacted && groundSplash) {
          splashTimer--
          if (splashTimer <= 0) {
            groundSplash.stop()
          }
        }
        // Clean up after impact animation complete
        if (impacted && weaponDelay < -25) {
          cleanupBeam()
          phase = 'COMPLETE'
          destroyed = true
        }
        break

      case 'COMPLETE':
        // Effect is done, wait for next fire
        break
    }
  }

  updateStatus()
  updateInfoBar()
  scene.render()
})

window.addEventListener('resize', () => { engine.resize() })
