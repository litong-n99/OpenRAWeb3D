/**
 * ch19-cnc/infantry-body/main.ts — Multi-layer infantry sprite rendering acceptance test
 *
 * Verifies:
 * 1. Body layer (base infantry mesh — green)
 * 2. Disguise layer (WithDisguisingInfantryBody — identity swapping)
 * 3. Attack overlay layer (WithSplitAttackPaletteInfantryBody — muzzle flash)
 * 4. Idle overlay layer (WithIdleOverlay — periodic blink)
 * 5. Harvester fullness (WithHarvesterSpriteBody — color gradient from empty to full)
 *
 * OpenRA source:
 *   OpenRA.Mods.Cnc/Traits/Render/WithDisguisingInfantryBody.cs (78 lines)
 *   OpenRA.Mods.Cnc/Traits/Render/WithSplitAttackPaletteInfantryBody.cs (58 lines)
 *   OpenRA.Mods.Cnc/Traits/Render/WithHarvesterSpriteBody.cs (50 lines)
 *
 * TS source:
 *   src/OpenRA.Mods.Cnc/Traits/Render/WithDisguisingInfantryBody.ts
 *   src/OpenRA.Mods.Cnc/Traits/Render/WithSplitAttackPaletteInfantryBody.ts
 *   src/OpenRA.Mods.Cnc/Traits/Render/WithHarvesterSpriteBody.ts
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
} from '@babylonjs/core'

const TICK_RATE = 1000 / 25

// ---------------------------------------------------------------------------
// Disguise identities
// ---------------------------------------------------------------------------

interface DisguiseConfig {
  name: string
  bodyColor: Color3
  overlayColor: Color3
  imageName: string
}

const DISGUISES: DisguiseConfig[] = [
  { name: '无伪装 (GDI)', bodyColor: new Color3(0.2, 0.53, 0.27), overlayColor: new Color3(0, 0, 0), imageName: 'e1' },
  { name: '盟军步兵', bodyColor: new Color3(0.4, 0.53, 0.8), overlayColor: new Color3(0.2, 0.3, 0.5), imageName: 'e1-disguised-allied' },
  { name: '苏联步兵', bodyColor: new Color3(0.8, 0.27, 0.27), overlayColor: new Color3(0.5, 0.1, 0.1), imageName: 'e1-disguised-soviet' },
]

// ---------------------------------------------------------------------------
// Scene State
// ---------------------------------------------------------------------------

let engine!: Engine
let scene!: Scene

// Layer meshes
let bodyMesh: Mesh
let disguiseOverlay: Mesh
let attackOverlay: Mesh
let idleOverlay: Mesh

// Materials for color changes
let bodyMat: StandardMaterial
let disguiseMat: StandardMaterial
let attackMat: StandardMaterial
let idleMat: StandardMaterial

let currentDisguiseIndex: number = 0
let fullness: number = 30
let isAttacking: boolean = false
let idleVisible: boolean = true
let idleTickCounter: number = 0
let attackTimer: number = 0

// ---------------------------------------------------------------------------
// Scene Setup
// ---------------------------------------------------------------------------

function setupScene(): void {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
  scene = new Scene(engine)
  scene.clearColor = new Color4(0.08, 0.12, 0.18, 1)

  const camera = new ArcRotateCamera('camera', 0, Math.PI / 2.5, 5, new Vector3(0, 0.5, 0), scene)
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 2
  camera.upperRadiusLimit = 12

  const hemi = new HemisphericLight('hemi', new Vector3(0.5, 1, -0.2), scene)
  hemi.intensity = 0.8

  // Ground
  const gMat = new StandardMaterial('gMat', scene)
  gMat.diffuseColor = new Color3(0.2, 0.25, 0.2)
  const ground = MeshBuilder.CreateGround('ground', { width: 10, height: 10 }, scene)
  ground.material = gMat

  // ===================================================================
  // Body Layer (base infantry — green default)
  // ===================================================================
  bodyMat = new StandardMaterial('bodyMat', scene)
  bodyMat.diffuseColor = DISGUISES[0].bodyColor.clone()
  bodyMat.specularColor = new Color3(0, 0, 0)

  bodyMesh = new Mesh('bodyMesh', scene)
  // Create a simple infantry figure: torso + head + limbs
  const torso = MeshBuilder.CreateBox('torso', { width: 0.35, height: 0.5, depth: 0.2 }, scene)
  torso.position.y = 0.65
  torso.material = bodyMat
  const head = MeshBuilder.CreateSphere('head', { diameter: 0.22 }, scene)
  head.position.y = 1.05
  head.material = bodyMat
  const leftArm = MeshBuilder.CreateCylinder('leftArm', { height: 0.4, diameter: 0.08 }, scene)
  leftArm.position = new Vector3(-0.25, 0.7, 0)
  leftArm.rotation.z = 0.3
  leftArm.material = bodyMat
  const rightArm = MeshBuilder.CreateCylinder('rightArm', { height: 0.4, diameter: 0.08 }, scene)
  rightArm.position = new Vector3(0.25, 0.7, 0)
  rightArm.rotation.z = -0.3
  rightArm.material = bodyMat
  const leftLeg = MeshBuilder.CreateCylinder('leftLeg', { height: 0.45, diameter: 0.09 }, scene)
  leftLeg.position = new Vector3(-0.1, 0.25, 0)
  leftLeg.material = bodyMat
  const rightLeg = MeshBuilder.CreateCylinder('rightLeg', { height: 0.45, diameter: 0.09 }, scene)
  rightLeg.position = new Vector3(0.1, 0.25, 0)
  rightLeg.material = bodyMat

  torso.parent = bodyMesh
  head.parent = bodyMesh
  leftArm.parent = bodyMesh
  rightArm.parent = bodyMesh
  leftLeg.parent = bodyMesh
  rightLeg.parent = bodyMesh
  bodyMesh.position = new Vector3(0, 0, 0)

  // ===================================================================
  // Disguise Overlay Layer (Z = -0.01 — behind body for silhouette)
  // ===================================================================
  disguiseMat = new StandardMaterial('disguiseMat', scene)
  disguiseMat.diffuseColor = new Color3(0, 0, 0)
  disguiseMat.alpha = 0.0
  disguiseMat.emissiveColor = new Color3(0, 0, 0)
  disguiseOverlay = MeshBuilder.CreatePlane('disguisePlane', { width: 0.8, height: 1.2 }, scene)
  disguiseOverlay.position = new Vector3(0, 0.6, -0.01)
  disguiseOverlay.billboardMode = Mesh.BILLBOARDMODE_Y
  disguiseOverlay.material = disguiseMat
  disguiseOverlay.isVisible = true

  // ===================================================================
  // Attack Overlay Layer (Z = 0.02 — in front, muzzle flash)
  // ===================================================================
  attackMat = new StandardMaterial('attackMat', scene)
  attackMat.diffuseColor = new Color3(1, 0.8, 0)
  attackMat.emissiveColor = new Color3(0.5, 0.3, 0)
  attackMat.alpha = 0.0
  attackOverlay = MeshBuilder.CreatePlane('attackPlane', { width: 0.5, height: 0.5 }, scene)
  attackOverlay.position = new Vector3(0.15, 0.9, 0.02)
  attackOverlay.billboardMode = Mesh.BILLBOARDMODE_Y
  attackOverlay.material = attackMat
  attackOverlay.isVisible = false

  // ===================================================================
  // Idle Overlay Layer (Z = 0.01 — periodic blue blink)
  // ===================================================================
  idleMat = new StandardMaterial('idleMat', scene)
  idleMat.diffuseColor = new Color3(0.27, 0.53, 1)
  idleMat.emissiveColor = new Color3(0.1, 0.2, 0.4)
  idleMat.alpha = 0.5
  idleOverlay = MeshBuilder.CreatePlane('idlePlane', { width: 0.9, height: 1.3 }, scene)
  idleOverlay.position = new Vector3(0, 0.6, 0.01)
  idleOverlay.billboardMode = Mesh.BILLBOARDMODE_Y
  idleOverlay.material = idleMat
}

// ---------------------------------------------------------------------------
// Layer Control Methods (mirrors the With* trait APIs)
// ---------------------------------------------------------------------------

function applyDisguise(index: number): void {
  currentDisguiseIndex = index
  const d = DISGUISES[index]

  bodyMat.diffuseColor = d.bodyColor.clone()
  disguiseMat.diffuseColor = d.overlayColor.clone()
  disguiseMat.alpha = index === 0 ? 0.0 : 0.7
  disguiseMat.emissiveColor = d.overlayColor.clone().scale(0.3)

  document.getElementById('st-disguise')!.textContent = d.name
  document.getElementById('st-image')!.textContent = d.imageName
}

function triggerAttack(): void {
  isAttacking = true
  attackTimer = 10 // 10 ticks = 400ms
  attackOverlay.isVisible = true
  attackMat.alpha = 0.9
}

function toggleIdleOverlay(): void {
  idleVisible = !idleVisible
  idleOverlay.isVisible = idleVisible
  document.getElementById('st-idle')!.textContent = String(idleVisible)
}

function applyFullness(value: number): void {
  fullness = value
  // Map fullness 0-100 to body tint: empty=green, full=gold
  const t = value / 100
  const r = 0.2 + t * 0.6  // 0.2 → 0.8
  const g = 0.53 + t * 0.14 // 0.53 → 0.67
  const b = 0.27 - t * 0.14 // 0.27 → 0.13
  bodyMat.diffuseColor = new Color3(r, g, b)
  document.getElementById('st-fullness')!.textContent = String(value)
}

function applyDisplayMode(mode: string): void {
  switch (mode) {
    case 'all':
      bodyMesh.position.x = 0
      bodyMesh.isVisible = true
      disguiseOverlay.position.z = -0.01
      disguiseOverlay.isVisible = true
      attackOverlay.position.z = 0.02
      attackOverlay.isVisible = isAttacking
      idleOverlay.position.z = 0.01
      idleOverlay.isVisible = idleVisible
      break
    case 'body-only':
      disguiseOverlay.isVisible = false
      attackOverlay.isVisible = false
      idleOverlay.isVisible = false
      break
    case 'overlay-only':
      bodyMesh.isVisible = false
      disguiseOverlay.isVisible = true
      attackOverlay.isVisible = isAttacking
      idleOverlay.isVisible = idleVisible
      break
    case 'exploded':
      // Offset each layer to the side
      bodyMesh.position.x = -0.8
      disguiseOverlay.position = new Vector3(-0.2, 0.6, -0.01)
      attackOverlay.position = new Vector3(0.3, 0.9, 0.02)
      idleOverlay.position = new Vector3(-0.5, 0.6, 0.01)
      bodyMesh.isVisible = true
      disguiseOverlay.isVisible = true
      attackOverlay.isVisible = isAttacking
      idleOverlay.isVisible = idleVisible
      break
  }
  document.getElementById('st-mode')!.textContent = mode
}

// ---------------------------------------------------------------------------
// UI Updates
// ---------------------------------------------------------------------------

function updateStatus(): void {
  document.getElementById('st-disguise')!.textContent = DISGUISES[currentDisguiseIndex].name
  document.getElementById('st-attack')!.textContent = String(isAttacking)
  document.getElementById('st-idle')!.textContent = String(idleVisible)
  document.getElementById('st-fullness')!.textContent = String(fullness)
  document.getElementById('st-image')!.textContent = DISGUISES[currentDisguiseIndex].imageName
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

let disguiseCycleCount = 0

function setupControls(): void {
  document.getElementById('btn-disguise')!.addEventListener('click', () => {
    disguiseCycleCount = (disguiseCycleCount + 1) % DISGUISES.length
    applyDisguise(disguiseCycleCount)
  })

  document.getElementById('btn-attack')!.addEventListener('click', () => {
    triggerAttack()
  })

  document.getElementById('btn-idle-overlay')!.addEventListener('click', () => {
    toggleIdleOverlay()
  })

  document.getElementById('rng-fullness')!.addEventListener('input', function(this: HTMLInputElement) {
    applyFullness(parseInt(this.value))
    document.getElementById('lbl-fullness')!.textContent = this.value
  })

  document.getElementById('sel-mode')!.addEventListener('change', function(this: HTMLSelectElement) {
    applyDisplayMode(this.value)
  })

  document.getElementById('btn-reset')!.addEventListener('click', () => {
    disguiseCycleCount = 0
    applyDisguise(0)
    fullness = 30
    ;(document.getElementById('rng-fullness') as HTMLInputElement).value = '30'
    document.getElementById('lbl-fullness')!.textContent = '30'
    applyFullness(30)
    isAttacking = false
    attackOverlay.isVisible = false
    attackMat.alpha = 0
    idleVisible = true
    idleOverlay.isVisible = true
    document.getElementById('st-idle')!.textContent = 'true'
    applyDisplayMode('all')
    ;(document.getElementById('sel-mode') as HTMLSelectElement).value = 'all'
    bodyMesh.isVisible = true
    bodyMesh.position.x = 0
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

    // Idle overlay blink: toggle every 25 ticks (1s), full cycle 50 ticks (2s)
    idleTickCounter++
    if (idleVisible && idleTickCounter % 25 === 0) {
      // Toggle alpha for blink effect
      idleMat.alpha = idleMat.alpha > 0.3 ? 0.15 : 0.5
    }

    // Attack timer countdown
    if (isAttacking) {
      attackTimer--
      attackMat.alpha = Math.max(0, attackTimer / 10) * 0.9
      if (attackTimer <= 0) {
        isAttacking = false
        attackOverlay.isVisible = false
        attackMat.alpha = 0
      }
    }
  }

  updateStatus()
  updateInfoBar()
  scene.render()
})

window.addEventListener('resize', () => { engine.resize() })
