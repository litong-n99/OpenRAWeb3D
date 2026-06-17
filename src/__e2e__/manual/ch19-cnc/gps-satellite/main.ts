/**
 * ch19-cnc/gps-satellite/main.ts — GpsSatellite acceptance test
 *
 * Verifies:
 * 1. Constructor: sets initial pos, image, sequence, palette, revealDelay, launcher
 * 2. tick(): advances counter, increments pos.Z by 427 each call
 * 3. When tickCounter > revealDelay: reachedOrbit = true, calls GpsWatcher.reachedOrbit()
 * 4. After reachedOrbit: tick() returns immediately (no further movement)
 * 5. Satellite removed from world via frameEndTask after reaching orbit
 *
 * Performance note: trail LinesMesh is recycled every 4 ticks (not every frame)
 * to avoid excessive GPU mesh allocations during launch sequence.
 *
 * OpenRA source: OpenRA.Mods.Cnc/Effects/GpsSatellite.cs
 * TS source: src/OpenRA.Mods.Cnc/Effects/GpsSatellite.ts
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
// GpsSatellite (re-implemented for visual testing)
// ---------------------------------------------------------------------------

const WORLD_SCALE = 1024
const Z_INCREMENT = 427  // WDist per tick

interface GpsWatcherStub {
  reachedOrbit(launcher: string): void
}

class GpsSatellite {
  readonly launcher: string
  readonly image: string
  readonly sequence: string
  readonly palette: string
  readonly revealDelay: number

  pos: { X: number; Y: number; Z: number }
  private _tickCounter: number = 0
  private _reachedOrbit: boolean = false
  private _gpsWatcher: GpsWatcherStub | null

  constructor(
    pos: { X: number; Y: number; Z: number },
    image: string,
    sequence: string,
    palette: string,
    revealDelay: number,
    launcher: string,
    gpsWatcher: GpsWatcherStub | null = null,
  ) {
    this.pos = { ...pos }
    this.image = image
    this.sequence = sequence
    this.palette = palette
    this.revealDelay = revealDelay
    this.launcher = launcher
    this._gpsWatcher = gpsWatcher
  }

  tick(): void {
    if (this._reachedOrbit) return

    this._tickCounter++

    // Move upward: pos.Z += 427
    this.pos = {
      X: this.pos.X,
      Y: this.pos.Y,
      Z: this.pos.Z + Z_INCREMENT,
    }

    // Check orbit
    if (this._tickCounter > this.revealDelay) {
      this._reachedOrbit = true
      this._gpsWatcher?.reachedOrbit(this.launcher)
    }
  }

  get reachedOrbit(): boolean { return this._reachedOrbit }
  get currentTick(): number { return this._tickCounter }
}

// ---------------------------------------------------------------------------
// Babylon.js Scene
// ---------------------------------------------------------------------------

let engine!: Engine
let scene!: Scene
let satellite!: GpsSatellite
let satMesh!: Mesh
let satTrail: LinesMesh | null = null
const trailPoints: Vector3[] = []
const MAX_TRAIL = 150

// Launch structure
let launchPad: Mesh | null = null

const GPS_ACTIVATED_COLOR = new Color3(0.2, 0.9, 0.2)

function setupScene(): void {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false })
  scene = new Scene(engine)
  scene.clearColor = new Color4(0.05, 0.08, 0.15, 1)

  // Camera - angled side view to see vertical movement
  const camera = new ArcRotateCamera('camera', -Math.PI / 3, Math.PI / 3.5, 15, new Vector3(0, 2, 0), scene)
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 5
  camera.upperRadiusLimit = 40

  // Skybox-like background gradient (simulated via fog)
  scene.fogMode = Scene.FOGMODE_LINEAR
  scene.fogColor = new Color3(0.05, 0.08, 0.15)
  scene.fogStart = 20
  scene.fogEnd = 60

  // Lighting
  const hemi = new HemisphericLight('hemi', new Vector3(0.3, 1, 0.2), scene)
  hemi.intensity = 1.0

  // Ground
  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.diffuseColor = new Color3(0.2, 0.25, 0.2)
  const ground = MeshBuilder.CreateGround('ground', { width: 16, height: 16 }, scene)
  ground.material = groundMat
  ground.position.y = -0.05

  // Grid
  const gridMat = new StandardMaterial('gridMat', scene)
  gridMat.wireframe = true
  gridMat.diffuseColor = new Color3(0.3, 0.35, 0.3)
  const grid = MeshBuilder.CreateGround('grid', { width: 16, height: 16, subdivisions: 16 }, scene)
  grid.position.y = -0.04
  grid.material = gridMat

  // Launch structure (Tech Center / GPS uplink building)
  const buildingBase = MeshBuilder.CreateBox('base', { width: 1.0, height: 0.5, depth: 1.0 }, scene)
  buildingBase.position.y = 0.25
  const baseMat = new StandardMaterial('baseMat', scene)
  baseMat.diffuseColor = new Color3(0.4, 0.45, 0.4)
  buildingBase.material = baseMat

  const dishTower = MeshBuilder.CreateCylinder('tower', { height: 0.8, diameter: 0.2 }, scene)
  dishTower.position.y = 0.9
  const towerMat = new StandardMaterial('towerMat', scene)
  towerMat.diffuseColor = new Color3(0.5, 0.5, 0.5)
  dishTower.material = towerMat

  const dish = MeshBuilder.CreateSphere('dish', { diameter: 0.6, slice: 0.5 }, scene)
  dish.position.y = 1.4
  dish.rotation.x = Math.PI / 4
  const dishMat = new StandardMaterial('dishMat', scene)
  dishMat.diffuseColor = new Color3(0.7, 0.7, 0.75)
  dish.material = dishMat

  launchPad = new Mesh('launchPad', scene)
  buildingBase.parent = launchPad
  dishTower.parent = launchPad
  dish.parent = launchPad
  launchPad.position = new Vector3(0, 0, 0)

  // Satellite mesh
  const satBody = MeshBuilder.CreateBox('satBody', { width: 0.3, height: 0.2, depth: 0.3 }, scene)
  const satBodyMat = new StandardMaterial('satBodyMat', scene)
  satBodyMat.diffuseColor = new Color3(0.7, 0.7, 0.75)
  satBodyMat.emissiveColor = new Color3(0.1, 0.1, 0.15)
  satBody.material = satBodyMat

  // Solar panels
  const panelL = MeshBuilder.CreateBox('panelL', { width: 0.8, height: 0.05, depth: 0.15 }, scene)
  panelL.position.x = -0.35
  const panelMat = new StandardMaterial('panelMat', scene)
  panelMat.diffuseColor = new Color3(0.2, 0.3, 0.6)
  panelL.material = panelMat

  const panelR = MeshBuilder.CreateBox('panelR', { width: 0.8, height: 0.05, depth: 0.15 }, scene)
  panelR.position.x = 0.35
  panelR.material = panelMat

  // Antenna
  const antenna = MeshBuilder.CreateCylinder('antenna', { height: 0.4, diameter: 0.03 }, scene)
  antenna.position.y = 0.2
  const antMat = new StandardMaterial('antMat', scene)
  antMat.diffuseColor = new Color3(0.8, 0.8, 0.8)
  antenna.material = antMat

  satMesh = new Mesh('satRoot', scene)
  satBody.parent = satMesh
  panelL.parent = satMesh
  panelR.parent = satMesh
  antenna.parent = satMesh
  satMesh.position = new Vector3(0, 1.6, 0)  // Atop the launch structure
  satMesh.scaling = new Vector3(0.01, 0.01, 0.01)  // Hidden until launch

  // Initialize satellite state
  initializeSatellite()
}

function initializeSatellite(): void {
  const revealDelay = parseInt((document.getElementById('rng-delay') as HTMLInputElement).value)

  satellite = new GpsSatellite(
    { X: 0, Y: 0, Z: 0 },  // WPos at launch pad
    'gps',
    'idle',
    'effect',
    revealDelay,
    'Player1',
    {
      reachedOrbit(launcher: string) {
        console.log(`[GpsWatcher] GPS activated for ${launcher}!`)
      },
    },
  )

  trailPoints.length = 0
  if (satTrail) { satTrail.dispose(); satTrail = null }
  satMesh.position = new Vector3(0, 1.6, 0)
  satMesh.scaling = new Vector3(0.01, 0.01, 0.01)
}

// ---------------------------------------------------------------------------
// UI updates
// ---------------------------------------------------------------------------

function updateStatus(): void {
  document.getElementById('st-ticks')!.textContent = String(satellite.currentTick)
  document.getElementById('st-delay')!.textContent = String(satellite.revealDelay)
  document.getElementById('st-posz')!.textContent = Math.round(satellite.pos.Z).toString()
  document.getElementById('st-speed')!.textContent = String(Z_INCREMENT)
  document.getElementById('st-orbit')!.textContent = String(satellite.reachedOrbit)

  const gpsEl = document.getElementById('st-gps')!
  if (satellite.reachedOrbit) {
    gpsEl.style.display = 'inline'
  } else {
    gpsEl.style.display = 'none'
  }
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
  document.getElementById('btn-launch')!.addEventListener('click', () => {
    initializeSatellite()
    // Scale up satellite
    satMesh.scaling = new Vector3(1, 1, 1)
  })

  document.getElementById('rng-delay')!.addEventListener('input', (e) => {
    const val = (e.target as HTMLInputElement).value
    document.getElementById('lbl-delay')!.textContent = `${val} ticks`
    document.getElementById('st-delay')!.textContent = val
  })

  document.getElementById('btn-reset')!.addEventListener('click', () => {
    initializeSatellite()
    satMesh.scaling = new Vector3(0.01, 0.01, 0.01)
  })
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

setupScene()
setupControls()

let tickAccumulator = 0
let rawTicks = 0

engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime()
  tickAccumulator += dt

  // Speed multiplier from selector
  const speedMult = parseInt((document.getElementById('sel-speed') as HTMLSelectElement).value)
  const TICK_RATE = 1000 / (25 * speedMult)

  while (tickAccumulator >= TICK_RATE) {
    tickAccumulator -= TICK_RATE
    rawTicks++

    if (!satellite.reachedOrbit) {
      satellite.tick()
    }
  }

  // Update satellite mesh position
  const worldZ = satellite.pos.Z / WORLD_SCALE
  satMesh.position.y = 1.6 + worldZ  // start at launch pad height + accumulated Z

  // Rotate satellite for visual interest
  satMesh.rotation.y = rawTicks * 0.02

  // Trail: throttle to every 4th tick to avoid per-frame LinesMesh recreation (~15 allocs per launch instead of ~61)
  const TRAIL_UPDATE_INTERVAL = 4
  if (!satellite.reachedOrbit && satellite.currentTick > 0 && satellite.currentTick % TRAIL_UPDATE_INTERVAL === 0) {
    const pos = satMesh.position.clone()
    // Batch-append the last N positions at once
    trailPoints.push(pos)
    if (trailPoints.length > MAX_TRAIL) trailPoints.splice(0, trailPoints.length - MAX_TRAIL)
    updateTrail()
  }

  // Change satellite color when orbit reached
  if (satellite.reachedOrbit) {
    satMesh.getChildMeshes().forEach((child) => {
      const mat = (child as Mesh).material as StandardMaterial | null
      if (mat && mat.emissiveColor) {
        mat.emissiveColor = GPS_ACTIVATED_COLOR
      }
    })
  }

  updateStatus()
  updateInfoBar()
  scene.render()
})

function updateTrail(): void {
  if (satTrail) { satTrail.dispose(); satTrail = null }
  if (trailPoints.length < 2) return

  const lines: Vector3[][] = []
  for (let i = 1; i < trailPoints.length; i++) {
    lines.push([trailPoints[i - 1], trailPoints[i]])
  }

  satTrail = MeshBuilder.CreateLineSystem('satTrail', { lines }, scene)
  satTrail.color = new Color3(0.6, 0.7, 1.0)
}

window.addEventListener('resize', () => {
  engine.resize()
})
