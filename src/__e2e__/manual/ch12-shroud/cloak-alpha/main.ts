/**
 * shroud/cloak-alpha/main.ts — Cloak Alpha Effect visual acceptance test
 *
 * Verifies:
 * 1. From owner's perspective: cloaked unit at alpha=0.55 (semi-transparent)
 * 2. From enemy's perspective: cloaked unit completely invisible (alpha=0)
 * 3. When uncloaked (attack/move): unit alpha=1.0 for both
 * 4. Re-cloak after CloakDelay ticks: fades back to 0.55/0
 *
 * Architecture mirrors Cloak trait (CloakStyle.Alpha, cloakedAlpha=0.55):
 *   - Owner: allied → isVisible = true even when cloaked, render at alpha=0.55
 *   - Enemy: NOT allied AND cloaked → invisible (alpha=0)
 *   - Uncloaked: remainingTime > 0 → renders at alpha=1.0 for everyone
 */

import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  Vector3,
  Color4,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Mesh,
  type AbstractMesh,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Constants (matching Cloak defaults)
// ---------------------------------------------------------------------------

const DEFAULT_ALPHA = 0.55   // CloakInfo.cloakedAlpha
let cloakDelay = 30           // ticks (CloakInfo.cloakDelay)

// ---------------------------------------------------------------------------
// Cloak State
// ---------------------------------------------------------------------------

let remainingTime = 0 // 0 = cloaked, >0 = uncloaked timer
let wasCloaked = true
let tickCount = 0

// ---------------------------------------------------------------------------
// Mesh references (owner scene)
// ---------------------------------------------------------------------------

let ownerUnit!: AbstractMesh
let ownerUnitMat!: StandardMaterial

// ---------------------------------------------------------------------------
// Mesh references (enemy scene)
// ---------------------------------------------------------------------------

let enemyUnit!: AbstractMesh
let enemyUnitMat!: StandardMaterial

// ---------------------------------------------------------------------------
// Apply visual state based on cloak status
// ---------------------------------------------------------------------------

function updateVisuals(): void {
  const isCloaked = remainingTime <= 0

  if (isCloaked) {
    // Owner: alpha = 0.55 (semi-transparent)
    ownerUnitMat.alpha = DEFAULT_ALPHA
    ownerUnit.isVisible = true

    // Enemy: completely invisible
    enemyUnit.isVisible = false
  } else {
    // Both: fully opaque
    ownerUnitMat.alpha = 1.0
    ownerUnit.isVisible = true
    enemyUnitMat.alpha = 1.0
    enemyUnit.isVisible = true
  }

  updateStatusPanel()
}

// ---------------------------------------------------------------------------
// Status Panel
// ---------------------------------------------------------------------------

function updateStatusPanel(): void {
  const isCloaked = remainingTime <= 0
  const statusText = document.getElementById('status-text')!
  const statusRemaining = document.getElementById('status-remaining')!
  const statusOwnerAlpha = document.getElementById('status-owner-alpha')!
  const statusEnemyAlpha = document.getElementById('status-enemy-alpha')!

  if (isCloaked) {
    statusText.className = 'cloaked'
    statusText.textContent = 'Cloaked'
    statusRemaining.textContent = '0 ticks'
    statusOwnerAlpha.textContent = String(DEFAULT_ALPHA)
    statusEnemyAlpha.textContent = '0.00'
  } else {
    statusText.className = 'uncloaked'
    statusText.textContent = 'Uncloaked'
    statusRemaining.textContent = `${remainingTime} ticks`
    statusOwnerAlpha.textContent = '1.00'
    statusEnemyAlpha.textContent = '1.00'
  }

  document.getElementById('cloak-timer')!.textContent = isCloaked
    ? 'Cloaked'
    : `Uncloaked: ${remainingTime} ticks`
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function uncloak(): void {
  remainingTime = Math.max(remainingTime, cloakDelay)
  updateVisuals()
}

function tickTimer(): void {
  if (remainingTime > 0) {
    remainingTime--
    if (remainingTime === 0 && !wasCloaked) {
      // Just re-cloaked
      wasCloaked = true
    }
  }
  if (remainingTime <= 0) {
    wasCloaked = true
  } else {
    wasCloaked = false
  }
  updateVisuals()
}

// ---------------------------------------------------------------------------
// Info Bar
// ---------------------------------------------------------------------------

const infoUa = document.getElementById('info-ua')!
const infoViewport = document.getElementById('info-viewport')!
const infoEngine = document.getElementById('info-engine')!
const infoFps = document.getElementById('info-fps')!
const infoTime = document.getElementById('info-time')!

function updateInfoBar(engine: Engine): void {
  infoUa.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  infoViewport.textContent = `${window.innerWidth}x${window.innerHeight}`
  infoEngine.textContent = engine.webGLVersion === 2 ? 'WebGL 2.0' : 'WebGL 1.0'
  infoFps.textContent = String(Math.round(engine.getFps()))
  infoTime.textContent = new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Left Viewport: Owner Scene
// ---------------------------------------------------------------------------

function setupOwnerScene(canvas: HTMLCanvasElement): { engine: Engine; scene: Scene } {
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false })
  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.12, 0.16, 0.12, 1) // slight green tint for owner

  const camera = new ArcRotateCamera(
    'camera-owner', Math.PI / 4, Math.PI / 3, 6,
    Vector3.Zero(), scene,
  )
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 2
  camera.upperRadiusLimit = 15

  new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)

  // Ground
  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.diffuseColor = new Color3(0.15, 0.25, 0.15)
  const ground = MeshBuilder.CreateGround('ground', { width: 4, height: 4 }, scene)
  ground.material = groundMat

  // Unit mesh: a tank-like shape
  const body = MeshBuilder.CreateBox('tankBody', { width: 0.8, height: 0.3, depth: 1.2 }, scene)
  body.position.y = 0.25
  const turret = MeshBuilder.CreateCylinder('tankTurret', { height: 0.15, diameter: 0.5 }, scene)
  turret.position.y = 0.45
  const barrel = MeshBuilder.CreateCylinder('tankBarrel', { height: 0.6, diameter: 0.08 }, scene)
  barrel.rotation.x = Math.PI / 2
  barrel.position.set(0, 0.45, 0.35)

  ownerUnitMat = new StandardMaterial('ownerUnitMat', scene)
  ownerUnitMat.diffuseColor = new Color3(0.8, 0.7, 0.3) // gold/yellow tank
  ownerUnitMat.alpha = DEFAULT_ALPHA
  ownerUnitMat.specularColor = new Color3(0.1, 0.1, 0.1)

  const unitGroup = new Mesh('ownerUnit', scene)
  body.parent = unitGroup
  turret.parent = unitGroup
  barrel.parent = unitGroup
  unitGroup.material = ownerUnitMat
  ownerUnit = unitGroup

  return { engine, scene }
}

// ---------------------------------------------------------------------------
// Right Viewport: Enemy Scene
// ---------------------------------------------------------------------------

function setupEnemyScene(canvas: HTMLCanvasElement): { engine: Engine; scene: Scene } {
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false })
  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.16, 0.12, 0.12, 1) // slight red tint for enemy

  const camera = new ArcRotateCamera(
    'camera-enemy', Math.PI / 4, Math.PI / 3, 6,
    Vector3.Zero(), scene,
  )
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 2
  camera.upperRadiusLimit = 15

  new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)

  // Ground
  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.diffuseColor = new Color3(0.18, 0.15, 0.15)
  const ground = MeshBuilder.CreateGround('ground', { width: 4, height: 4 }, scene)
  ground.material = groundMat

  // Unit mesh (same tank shape)
  const body = MeshBuilder.CreateBox('tankBody', { width: 0.8, height: 0.3, depth: 1.2 }, scene)
  body.position.y = 0.25
  const turret = MeshBuilder.CreateCylinder('tankTurret', { height: 0.15, diameter: 0.5 }, scene)
  turret.position.y = 0.45
  const barrel = MeshBuilder.CreateCylinder('tankBarrel', { height: 0.6, diameter: 0.08 }, scene)
  barrel.rotation.x = Math.PI / 2
  barrel.position.set(0, 0.45, 0.35)

  enemyUnitMat = new StandardMaterial('enemyUnitMat', scene)
  enemyUnitMat.diffuseColor = new Color3(0.8, 0.7, 0.3)
  enemyUnitMat.alpha = 1.0
  enemyUnitMat.specularColor = new Color3(0.1, 0.1, 0.1)

  const unitGroup = new Mesh('enemyUnit', scene)
  body.parent = unitGroup
  turret.parent = unitGroup
  barrel.parent = unitGroup
  unitGroup.material = enemyUnitMat
  enemyUnit = unitGroup

  // Initially invisible (cloaked from enemy perspective)
  enemyUnit.isVisible = false

  return { engine, scene }
}

// ---------------------------------------------------------------------------
// Timer (simulates game ticks at ~25fps = 40ms per tick)
// ---------------------------------------------------------------------------

const TICK_INTERVAL_MS = 100 // visually visible tick speed (actual OpenRA uses ~40ms)

let tickIntervalId: ReturnType<typeof setInterval> | null = null

function startTickLoop(): void {
  if (tickIntervalId) clearInterval(tickIntervalId)
  tickIntervalId = setInterval(() => {
    if (tickCount % 5 === 0) { // every 5 ticks actually count down one visual tick
      tickTimer()
    }
    tickCount++
  }, TICK_INTERVAL_MS / 5)
}

// ---------------------------------------------------------------------------
// UI Controls
// ---------------------------------------------------------------------------

function setupControls(): void {
  document.getElementById('btn-attack')!.addEventListener('click', () => {
    uncloak()
  })

  document.getElementById('btn-move')!.addEventListener('click', () => {
    uncloak()
    // Simulate small movement
    ownerUnit.position.x += 0.1
    enemyUnit.position.x += 0.1
  })

  document.getElementById('btn-cloak-only')!.addEventListener('click', () => {
    remainingTime = 0
    updateVisuals()
  })

  const rangeDelay = document.getElementById('range-delay') as HTMLInputElement
  const valDelay = document.getElementById('val-delay')!
  rangeDelay.addEventListener('input', () => {
    cloakDelay = parseInt(rangeDelay.value, 10)
    valDelay.textContent = `${cloakDelay} ticks`
  })

  window.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'a': case 'A': uncloak(); break
      case 'm': case 'M':
        uncloak()
        ownerUnit.position.x += 0.1
        enemyUnit.position.x += 0.1
        break
      case 'c': case 'C':
        remainingTime = 0
        updateVisuals()
        break
    }
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const canvasOwner = document.getElementById('canvas-owner') as HTMLCanvasElement
const canvasEnemy = document.getElementById('canvas-enemy') as HTMLCanvasElement

const { engine: engineOwner, scene: sceneOwner } = setupOwnerScene(canvasOwner)
const { engine: engineEnemy, scene: sceneEnemy } = setupEnemyScene(canvasEnemy)

setupControls()
startTickLoop()

// Start cloaked
updateVisuals()

engineOwner.runRenderLoop(() => { sceneOwner.render() })
engineEnemy.runRenderLoop(() => {
  sceneEnemy.render()
  updateInfoBar(engineEnemy)
})

window.addEventListener('resize', () => {
  engineOwner.resize()
  engineEnemy.resize()
})

;(window as unknown as Record<string, unknown>).__cloakAlphaTest = {
  remainingTime,
  cloakDelay,
  ownerUnit,
  enemyUnit,
  uncloak,
  updateVisuals,
  get isCloaked() { return remainingTime <= 0 },
  get ownerAlpha() { return remainingTime <= 0 ? DEFAULT_ALPHA : 1.0 },
  get enemyVisible() { return remainingTime > 0 },
}
