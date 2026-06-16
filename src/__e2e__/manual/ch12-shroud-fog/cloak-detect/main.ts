/**
 * shroud/cloak-detect/main.ts — Cloak Detection visual acceptance test
 *
 * Verifies:
 * 1. Cloaked unit invisible when detector outside detection range
 * 2. Cloaked unit fully visible when detector within detection range
 * 3. Cloaked unit becomes invisible again when detector moves back out of range
 * 4. DetectionTypes filtering — only matching types reveal the cloaked unit
 *
 * Architecture mirrors DetectCloaked trait:
 *   - Detection range from DetectCloakedInfo.Range (default WDist.fromCells(5))
 *   - DetectionTypes matching: subTypes ∩ cloakedTypes must overlap
 *   - Distance check: squared distance ≤ range² (matching C# LengthSquared)
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
  DynamicTexture,
  Color3,
  Mesh,
  type AbstractMesh,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CLOAKED_ALPHA = 0.55

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let detectorX = -3.0
let detectorZ = 0.0
let detectionRange = 2.0 // world units (cell-based; 1 unit ~ 1 cell)
let detectorTypes: string[] = ['Cloak']
let cloakedTypes: string[] = ['Cloak'] // the cloaked unit's detection types

// Cloaked unit position (fixed at origin)
const CLOAKED_POS = new Vector3(0, 0.25, 0)

// ---------------------------------------------------------------------------
// Mesh references
// ---------------------------------------------------------------------------

let cloakedUnit!: AbstractMesh
let cloakedUnitMat!: StandardMaterial
let detectorUnit!: AbstractMesh
let detectionCircle!: AbstractMesh

// ---------------------------------------------------------------------------
// Detection logic
// ---------------------------------------------------------------------------

function computeDistance(): number {
  const dx = detectorX - CLOAKED_POS.x
  const dz = detectorZ - CLOAKED_POS.z
  return Math.sqrt(dx * dx + dz * dz)
}

function isDetected(): boolean {
  const dist = computeDistance()
  if (dist > detectionRange) return false

  // Check DetectionTypes overlap
  const overlap = detectorTypes.some(dt => cloakedTypes.includes(dt))
  if (!overlap) return false

  return true
}

function updateVisuals(): void {
  const dist = computeDistance()
  const detected = isDetected()

  if (detected) {
    cloakedUnitMat.alpha = 1.0
    cloakedUnit.isVisible = true
  } else {
    cloakedUnitMat.alpha = CLOAKED_ALPHA
    cloakedUnit.isVisible = false
  }

  // Move detector
  detectorUnit.position.x = detectorX
  detectorUnit.position.z = detectorZ

  // Update detection circle visualization
  if (detectionCircle) {
    detectionCircle.position.x = detectorX
    detectionCircle.position.z = detectorZ
    ;(detectionCircle as unknown as { scaling: Vector3 }).scaling = new Vector3(detectionRange, 1, detectionRange)
  }

  // Update status text colors
  const isInRange = dist <= detectionRange
  const typeMatch = detectorTypes.some(dt => cloakedTypes.includes(dt))

  updateStatusPanel(dist, detected, isInRange, typeMatch)
}

function updateStatusPanel(dist: number, detected: boolean, inRange: boolean, typeMatch: boolean): void {
  const sd = document.getElementById('status-dist')!
  const sdetect = document.getElementById('status-detect')!
  const stype = document.getElementById('status-type')!

  sd.textContent = dist.toFixed(2)

  if (detected) {
    sdetect.className = 'detected'
    sdetect.textContent = `DETECTED (范围内=${inRange}, 类型匹配=${typeMatch})`
  } else if (inRange && !typeMatch) {
    sdetect.className = 'not-detected'
    sdetect.textContent = `Not Detected (范围内但类型不匹配)`
  } else if (!inRange) {
    sdetect.className = 'not-detected'
    sdetect.textContent = `Not Detected (距离超出范围: ${dist.toFixed(2)} > ${detectionRange.toFixed(1)})`
  } else {
    sdetect.className = 'not-detected'
    sdetect.textContent = 'Not Detected'
  }

  stype.textContent = detectorTypes.join(',') || 'None'
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
// Babylon.js Scene
// ---------------------------------------------------------------------------

function setupScene(): { engine: Engine; scene: Scene } {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false })
  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.12, 0.14, 0.18, 1)

  const camera = new ArcRotateCamera(
    'camera',
    -Math.PI / 4, Math.PI / 3.5, 10,
    Vector3.Zero(),
    scene,
  )
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 2
  camera.upperRadiusLimit = 25

  new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)
  new HemisphericLight('fill', new Vector3(-0.3, 0.5, -0.5), scene).intensity = 0.3

  // Ground — checkerboard
  const groundW = 8, groundH = 8
  const gtex = new DynamicTexture('gtex', { width: 400, height: 200 }, scene, false)
  const gctx = gtex.getContext() as CanvasRenderingContext2D
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 8; col++) {
      gctx.fillStyle = (row + col) % 2 === 0 ? '#1a3a1a' : '#2a5a2a'
      gctx.fillRect(col * 50, row * 50, 50, 50)
    }
  }
  gctx.strokeStyle = '#4a4'
  gctx.lineWidth = 2
  for (let i = 0; i <= 8; i++) { gctx.beginPath(); gctx.moveTo(i * 50, 0); gctx.lineTo(i * 50, 200); gctx.stroke() }
  for (let i = 0; i <= 4; i++) { gctx.beginPath(); gctx.moveTo(0, i * 50); gctx.lineTo(400, i * 50); gctx.stroke() }
  gtex.update(false)

  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.diffuseTexture = gtex
  groundMat.specularColor = new Color3(0.05, 0.05, 0.05)

  const ground = MeshBuilder.CreateGround('ground', { width: groundW, height: groundH }, scene)
  ground.material = groundMat

  // -------------------------------------------------------------------------
  // Cloaked unit (infantry mesh at origin)
  // -------------------------------------------------------------------------

  const body = MeshBuilder.CreateBox('infantryBody', { width: 0.3, height: 0.4, depth: 0.2 }, scene)
  body.position.y = 0.3
  const head = MeshBuilder.CreateSphere('infantryHead', { diameter: 0.2 }, scene)
  head.position.y = 0.55

  cloakedUnitMat = new StandardMaterial('cloakedMat', scene)
  cloakedUnitMat.diffuseColor = new Color3(0.9, 0.3, 0.2) // red infantry
  cloakedUnitMat.alpha = CLOAKED_ALPHA
  cloakedUnitMat.specularColor = new Color3(0, 0, 0)

  const infantryGroup = new Mesh('cloakedUnit', scene)
  body.parent = infantryGroup
  head.parent = infantryGroup
  infantryGroup.position.copyFrom(CLOAKED_POS)
  infantryGroup.material = cloakedUnitMat
  cloakedUnit = infantryGroup

  // -------------------------------------------------------------------------
  // Detector unit (scanner vehicle)
  // -------------------------------------------------------------------------

  const dbody = MeshBuilder.CreateBox('detectorBody', { width: 0.6, height: 0.25, depth: 0.8 }, scene)
  dbody.position.y = 0.2
  const dant = MeshBuilder.CreateCylinder('detectorAntenna', { height: 0.5, diameter: 0.08 }, scene)
  dant.position.y = 0.5

  const detectorMat = new StandardMaterial('detectorMat', scene)
  detectorMat.diffuseColor = new Color3(0.2, 0.6, 0.9) // blue scanner
  detectorMat.specularColor = new Color3(0.1, 0.1, 0.1)

  const detectorGroup = new Mesh('detectorUnit', scene)
  dbody.parent = detectorGroup
  dant.parent = detectorGroup
  detectorGroup.position.set(detectorX, 0, detectorZ)
  detectorGroup.material = detectorMat
  detectorUnit = detectorGroup

  // -------------------------------------------------------------------------
  // Detection range circle (semi-transparent disc)
  // -------------------------------------------------------------------------

  const disc = MeshBuilder.CreateDisc('detectionDisc', { radius: 1, tessellation: 64 }, scene)
  disc.rotation.x = Math.PI / 2 // flat on ground
  disc.position.set(detectorX, 0.01, detectorZ)
  disc.scaling.set(detectionRange, 1, detectionRange)

  const discMat = new StandardMaterial('discMat', scene)
  discMat.diffuseColor = new Color3(0.2, 0.6, 1.0)
  discMat.alpha = 0.2
  discMat.specularColor = new Color3(0, 0, 0)
  discMat.backFaceCulling = false
  disc.material = discMat
  detectionCircle = disc

  // Range ring outline
  const ringPoints: Vector3[][] = [[]]
  const n = 64
  for (let i = 0; i <= n; i++) {
    const angle = (2 * Math.PI * i) / n
    ringPoints[0].push(new Vector3(Math.cos(angle), 0.015, Math.sin(angle)))
  }
  const ring = MeshBuilder.CreateLineSystem('rangeRing', { lines: ringPoints, colors: [[new Color4(0.3, 0.7, 1.0, 0.6)]] }, scene)
  ring.parent = disc

  return { engine, scene }
}

// ---------------------------------------------------------------------------
// UI Controls
// ---------------------------------------------------------------------------

function setupControls(): void {
  const rangeX = document.getElementById('range-detect-x') as HTMLInputElement
  const valX = document.getElementById('val-detect-x')!
  const rangeZ = document.getElementById('range-detect-z') as HTMLInputElement
  const valZ = document.getElementById('val-detect-z')!
  const rangeR = document.getElementById('range-detect-r') as HTMLInputElement
  const valR = document.getElementById('val-detect-r')!
  const selType = document.getElementById('sel-detect-type') as HTMLSelectElement

  rangeX.addEventListener('input', () => {
    detectorX = parseFloat(rangeX.value)
    valX.textContent = detectorX.toFixed(1)
    updateVisuals()
  })

  rangeZ.addEventListener('input', () => {
    detectorZ = parseFloat(rangeZ.value)
    valZ.textContent = detectorZ.toFixed(1)
    updateVisuals()
  })

  rangeR.addEventListener('input', () => {
    detectionRange = parseFloat(rangeR.value)
    valR.textContent = detectionRange.toFixed(1)
    updateVisuals()
  })

  selType.addEventListener('change', () => {
    switch (selType.value) {
      case 'Cloak': detectorTypes = ['Cloak']; break
      case 'Subterranean': detectorTypes = ['Subterranean']; break
      case 'Both': detectorTypes = ['Cloak', 'Subterranean']; break
      case 'None': detectorTypes = []; break
    }
    updateVisuals()
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { engine, scene } = setupScene()
setupControls()

// Start with detector far away (invisible)
updateVisuals()

engine.runRenderLoop(() => {
  scene.render()
  updateInfoBar(engine)
})

window.addEventListener('resize', () => { engine.resize() })

;(window as unknown as Record<string, unknown>).__cloakDetectTest = {
  detectorX, detectorZ, detectionRange,
  detectorTypes, cloakedTypes,
  cloakedUnit, detectorUnit, detectionCircle,
  computeDistance,
  isDetected,
  updateVisuals,
  setDetectorPos: (x: number, z: number) => { detectorX = x; detectorZ = z; updateVisuals() },
  setRange: (r: number) => { detectionRange = r; updateVisuals() },
  setDetectorTypes: (types: string[]) => { detectorTypes = types; updateVisuals() },
}
