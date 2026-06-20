/**
 * main.ts — Shellmap 背景人工验收测试
 *
 * 测试目标:
 *   1. 验证 Shellmap 3D 场景在菜单覆盖层后正确渲染（canvas + DOM overlay z-order）
 *   2. 验证无 Shellmap 时回退到纯色背景 #0d0d1a (Color4: 0.05, 0.05, 0.1, 1.0)
 *   3. 验证菜单覆盖层半透明效果（rgba(10,10,30,0.75)），shellmap 可见
 *   4. 验证背景色到 shellmap 场景的过渡动画（500ms opacity fade）
 *   5. 验证 canvas 样式和尺寸随 sandbox 自适应
 *
 * OpenRA 对照: Game.ts — setShellmapFallback() → clearColor = Color4(0.05, 0.05, 0.1, 1.0)
 *              Game.ts — showMainMenu() → 有 shellmap 地图: canvas 渲染 / 无: 纯色背景
 *              Game.ts — _showMainMenuDomOverlay() → 菜单覆盖层 rgba(10,10,30,0.75)
 *
 * 设计说明:
 *   本测试页面创建 Babylon.js 3D 场景模拟 shellmap（地面、建筑、单位、轨道摄像机），
 *   并在其上方渲染半透明 DOM 菜单覆盖层。两个独立状态可切换：
 *   1. shellmapActive: true → canvas 可见渲染 3D 场景 / false → canvas 隐藏，回退背景色
 *   2. overlayVisible: true → 菜单覆盖层可见 / false → 仅背景可见
 */

import { Engine } from '@babylonjs/core'
import { Scene } from '@babylonjs/core'
import { ArcRotateCamera } from '@babylonjs/core'
import { HemisphericLight } from '@babylonjs/core'
import { DirectionalLight } from '@babylonjs/core'
import { Vector3 } from '@babylonjs/core'
import { Color3, Color4 } from '@babylonjs/core'
import { MeshBuilder } from '@babylonjs/core'
import { StandardMaterial } from '@babylonjs/core'
import { DynamicTexture } from '@babylonjs/core'
import type { Mesh } from '@babylonjs/core'

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------

const sandbox = document.getElementById('sandbox')!
const infoUa = document.getElementById('info-ua')!
const infoViewport = document.getElementById('info-viewport')!
const infoEngine = document.getElementById('info-engine')!
const infoFps = document.getElementById('info-fps')!
const infoTime = document.getElementById('info-time')!
const bgColorInfo = document.getElementById('bg-color-info')!
const modeLabel = document.getElementById('mode-label')!
const infoMeshCount = document.getElementById('info-mesh-count')!
const infoTriCount = document.getElementById('info-tri-count')!
const infoDrawCalls = document.getElementById('info-draw-calls')!
const infoShellmapState = document.getElementById('info-shellmap-state')!
const menuOverlay = document.getElementById('menu-overlay')!

// Check indicators
const chkCanvasExists = document.getElementById('chk-canvas-exists')!
const chkShellmapRendering = document.getElementById('chk-shellmap-rendering')!
const chkFallbackColor = document.getElementById('chk-fallback-color')!
const chkOverlayOpacity = document.getElementById('chk-overlay-opacity')!
const chkZOrder = document.getElementById('chk-z-order')!
const chkTransition = document.getElementById('chk-transition')!

// Controls
const btnToggleShellmap = document.getElementById('btn-toggle-shellmap') as HTMLButtonElement
const btnToggleOverlay = document.getElementById('btn-toggle-overlay') as HTMLButtonElement
const btnTestTransition = document.getElementById('btn-test-transition') as HTMLButtonElement
const sliderOpacity = document.getElementById('slider-opacity') as HTMLInputElement
const opacityVal = document.getElementById('opacity-val')!
const sliderClearColor = document.getElementById('slider-clearcolor') as HTMLInputElement
const clearColorVal = document.getElementById('clearcolor-val')!

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface AppState {
  shellmapActive: boolean
  overlayVisible: boolean
  overlayOpacity: number
  clearColorAlpha: number
}

const state: AppState = {
  shellmapActive: false, // Start in fallback mode
  overlayVisible: true,
  overlayOpacity: 0.75,
  clearColorAlpha: 1.0,
}

// Babylon.js globals; initialized in initEngine()
let engine: Engine | null = null
let scene: Scene | null = null
let canvas: HTMLCanvasElement | null = null
let camera: ArcRotateCamera | null = null
let totalTriangles = 0
let meshCount = 0
let drawCalls = 0

// ---------------------------------------------------------------------------
// Info Bar
// ---------------------------------------------------------------------------

function updateInfoBar(): void {
  infoUa.textContent = navigator.userAgent.slice(0, 80)
  infoViewport.textContent = `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
  infoTime.textContent = new Date().toISOString()
}

window.addEventListener('resize', updateInfoBar)
updateInfoBar()

// ---------------------------------------------------------------------------
// Menu Overlay
// ---------------------------------------------------------------------------

function updateOverlay(): void {
  const card = document.getElementById('menu-card')!
  if (state.overlayVisible) {
    menuOverlay!.classList.remove('hidden')
    card.style.background = `rgba(10,10,30,${state.overlayOpacity})`
    card.style.borderColor = `rgba(100,100,180,${0.3 * (state.overlayOpacity / 0.75)})`
    btnToggleOverlay.textContent = '⊗ 隐藏菜单覆盖层'
    btnToggleOverlay.className = 'danger'
  } else {
    menuOverlay!.classList.add('hidden')
    btnToggleOverlay.textContent = '▶ 显示菜单覆盖层'
    btnToggleOverlay.className = 'primary'
  }
}

function centerOverlay(): void {
  const sw = sandbox.getBoundingClientRect()
  const ow = menuOverlay!.offsetWidth || 400
  const oh = menuOverlay!.offsetHeight || 380
  const left = (sw.width - ow) / 2
  const top = (sw.height - oh) / 2
  menuOverlay!.style.left = `${left}px`
  menuOverlay!.style.top = `${top}px`
}

// ---------------------------------------------------------------------------
// Shellmap Scene Creation
// ---------------------------------------------------------------------------

function createGroundTexture(scene: Scene): StandardMaterial {
  const tex = new DynamicTexture('ground_tex', { width: 512, height: 512 }, scene, false)
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D

  // Base grass color
  ctx.fillStyle = '#2d5a1e'
  ctx.fillRect(0, 0, 512, 512)

  // Grid lines (subtle)
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = 1
  for (let i = 0; i <= 512; i += 32) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke()
  }

  // Random darker patches (simulating terrain variation)
  ctx.fillStyle = 'rgba(0,0,0,0.15)'
  for (let p = 0; p < 60; p++) {
    const px = Math.random() * 512
    const py = Math.random() * 512
    const pr = 8 + Math.random() * 30
    ctx.beginPath()
    ctx.arc(px, py, pr, 0, Math.PI * 2)
    ctx.fill()
  }

  // Lighter patches
  ctx.fillStyle = 'rgba(100,200,80,0.08)'
  for (let p = 0; p < 20; p++) {
    const px = Math.random() * 512
    const py = Math.random() * 512
    const pr = 10 + Math.random() * 50
    ctx.beginPath()
    ctx.arc(px, py, pr, 0, Math.PI * 2)
    ctx.fill()
  }

  tex.update(true)
  const mat = new StandardMaterial('ground_mat', scene)
  mat.diffuseTexture = tex
  mat.specularColor.set(0, 0, 0)
  return mat
}

interface BldDef {
  name: string
  x: number
  z: number
  w: number
  d: number
  h: number
  r: number
  g: number
  b: number
}

const BUILDINGS: BldDef[] = [
  { name: 'bld_conyard', x: -8, z: -4, w: 3.0, d: 2.8, h: 1.6, r: 180, g: 180, b: 160 },
  { name: 'bld_barracks', x: -3, z: -3, w: 2.4, d: 2.0, h: 1.2, r: 140, g: 160, b: 120 },
  { name: 'bld_refinery', x: 2, z: 1, w: 2.8, d: 2.2, h: 1.3, r: 200, g: 170, b: 120 },
  { name: 'bld_power', x: 6, z: -1, w: 1.8, d: 1.8, h: 1.5, r: 160, g: 140, b: 180 },
  { name: 'bld_warfactory', x: -5, z: 5, w: 3.2, d: 2.6, h: 1.4, r: 170, g: 155, b: 130 },
  { name: 'bld_defense', x: 8, z: 5, w: 1.5, d: 1.5, h: 2.0, r: 130, g: 130, b: 140 },
]

const UNITS: BldDef[] = [
  { name: 'unit_tank1', x: -6, z: 0, w: 1.0, d: 0.7, h: 0.5, r: 100, g: 120, b: 60 },
  { name: 'unit_tank2', x: 1, z: -2, w: 1.0, d: 0.7, h: 0.5, r: 110, g: 100, b: 70 },
  { name: 'unit_harv', x: 4, z: 4, w: 1.2, d: 0.9, h: 0.7, r: 200, g: 180, b: 80 },
  { name: 'unit_inf1', x: -1, z: 4, w: 0.4, d: 0.4, h: 0.8, r: 80, g: 140, b: 100 },
  { name: 'unit_inf2', x: 7, z: 3, w: 0.4, d: 0.4, h: 0.8, r: 90, g: 90, b: 160 },
]

function createBuilding(s: Scene, def: BldDef): Mesh {
  const box = MeshBuilder.CreateBox(def.name, { width: def.w, depth: def.d, height: def.h }, s)
  box.position = new Vector3(def.x, def.h / 2, def.z)

  const mat = new StandardMaterial(`mat_${def.name}`, s)
  const color = new Color3(def.r / 255, def.g / 255, def.b / 255)
  mat.diffuseColor = color
  mat.specularColor.set(0.05, 0.05, 0.05)
  box.material = mat

  // Small roof detail (slightly offset platform)
  const roof = MeshBuilder.CreateBox(`${def.name}_roof`, { width: def.w * 0.7, depth: def.d * 0.7, height: 0.1 }, s)
  roof.position = new Vector3(def.x, def.h + 0.15, def.z)
  const roofMat = new StandardMaterial(`mat_${def.name}_roof`, s)
  roofMat.diffuseColor = new Color3(color.r * 0.8, color.g * 0.8, color.b * 0.8)
  roofMat.specularColor.set(0.02, 0.02, 0.02)
  roof.material = roofMat

  return box
}

function createUnit(s: Scene, def: BldDef): Mesh {
  const box = MeshBuilder.CreateBox(def.name, { width: def.w, depth: def.d, height: def.h }, s)
  box.position = new Vector3(def.x, def.h / 2, def.z)

  const mat = new StandardMaterial(`mat_${def.name}`, s)
  const color = new Color3(def.r / 255, def.g / 255, def.b / 255)
  mat.diffuseColor = color
  mat.specularColor.set(0.08, 0.08, 0.08)
  box.material = mat

  // Turret-like top
  const turret = MeshBuilder.CreateCylinder(`${def.name}_turret`, { diameter: def.w * 0.5, height: 0.15 }, s)
  turret.position = new Vector3(def.x, def.h + 0.05, def.z)
  const turretMat = new StandardMaterial(`mat_${def.name}_turret`, s)
  turretMat.diffuseColor = new Color3(color.r * 0.7, color.g * 0.7, color.b * 0.7)
  turretMat.specularColor.set(0.05, 0.05, 0.05)
  turret.material = turretMat

  return box
}

function buildShellmapScene(scene: Scene): Mesh[] {
  const meshes: Mesh[] = []

  // Ground plane
  const groundMat = createGroundTexture(scene)
  const ground = MeshBuilder.CreatePlane('ground', { width: 24, height: 24 }, scene)
  ground.position = new Vector3(0, -0.05, 0)
  ground.rotation.x = -Math.PI / 2
  ground.material = groundMat
  ground.receiveShadows = true
  meshes.push(ground)

  // Buildings
  for (const def of BUILDINGS) {
    meshes.push(createBuilding(scene, def))
  }

  // Units
  for (const def of UNITS) {
    meshes.push(createUnit(scene, def))
  }

  // Trees (simple cylinders with sphere tops)
  const treePositions = [
    { x: -9, z: -2 }, { x: -7, z: 3 }, { x: 0, z: -6 },
    { x: 3, z: -5 }, { x: 5, z: 7 }, { x: -4, z: -7 },
    { x: 9, z: -4 }, { x: -9, z: 6 },
  ]
  for (const tp of treePositions) {
    const trunkH = 1.0 + Math.random() * 0.6
    const trunk = MeshBuilder.CreateCylinder(`tree_t_${tp.x}_${tp.z}`, { diameter: 0.2, height: trunkH }, scene)
    trunk.position = new Vector3(tp.x, trunkH / 2, tp.z)
    const trunkMat = new StandardMaterial(`tree_t_mat_${tp.x}_${tp.z}`, scene)
    trunkMat.diffuseColor = new Color3(0.35, 0.18, 0.05)
    trunkMat.specularColor.set(0, 0, 0)
    trunk.material = trunkMat
    meshes.push(trunk)

    const crown = MeshBuilder.CreateSphere(`tree_c_${tp.x}_${tp.z}`, { diameter: 0.9 + Math.random() * 0.5 }, scene)
    crown.position = new Vector3(tp.x, trunkH + 0.3, tp.z)
    const crownMat = new StandardMaterial(`tree_c_mat_${tp.x}_${tp.z}`, scene)
    crownMat.diffuseColor = new Color3(0.15 + Math.random() * 0.1, 0.4 + Math.random() * 0.2, 0.1)
    crownMat.specularColor.set(0, 0, 0)
    crown.material = crownMat
    meshes.push(crown)
  }

  // Count triangles
  totalTriangles = 0
  for (const m of meshes) {
    const indices = m.getTotalIndices()
    totalTriangles += indices ? Math.floor(indices / 3) : 0
  }
  meshCount = meshes.length

  return meshes
}

// ---------------------------------------------------------------------------
// Engine & Scene Initialization
// ---------------------------------------------------------------------------

function initEngine(): boolean {
  canvas = document.createElement('canvas')
  canvas.style.position = 'absolute'
  canvas.style.inset = '0'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.outline = 'none'
  canvas.style.touchAction = 'none'
  canvas.style.transition = 'opacity 0.5s ease'
  canvas.style.zIndex = '0'
  canvas.className = state.shellmapActive ? 'visible' : 'hidden'

  const rect = sandbox.getBoundingClientRect()
  canvas.width = Math.max(rect.width || 800, 1)
  canvas.height = Math.max(rect.height || 600, 1)
  sandbox.appendChild(canvas)

  try {
    engine = new Engine(canvas, true, {
      preserveDrawingBuffer: false,
      stencil: true,
      antialias: true,
    })
  } catch {
    document.getElementById('gpu-error')!.style.display = 'flex'
    infoEngine.textContent = 'UNAVAILABLE'
    return false
  }

  infoEngine.textContent = `Babylon.js v${Engine.Version} / WebGL ${engine.webGLVersion}.0`

  // Create scene
  scene = new Scene(engine)
  scene.clearColor = new Color4(0.05, 0.05, 0.1, state.clearColorAlpha)

  // Lighting
  const hemiLight = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)
  hemiLight.intensity = 0.6
  hemiLight.diffuse = new Color3(0.9, 0.9, 0.85)
  hemiLight.groundColor = new Color3(0.3, 0.3, 0.2)

  const dirLight = new DirectionalLight('sun', new Vector3(0.5, -0.8, 0.3), scene)
  dirLight.intensity = 0.7
  dirLight.diffuse = new Color3(1, 0.95, 0.8)

  // Fog for atmosphere
  scene.fogMode = Scene.FOGMODE_LINEAR
  scene.fogColor = new Color3(0.05, 0.05, 0.08)
  scene.fogStart = 20
  scene.fogEnd = 50

  // Camera
  camera = new ArcRotateCamera(
    'cam',
    -Math.PI / 4,
    Math.PI / 3,
    18,
    new Vector3(0, 0, 0),
    scene,
  )
  camera.lowerRadiusLimit = 10
  camera.upperRadiusLimit = 30
  camera.lowerBetaLimit = 0.3
  camera.upperBetaLimit = 1.2
  camera.panningSensibility = 0
  // Allow mouse wheel zoom only (no pan, no rotate for simplicity)
  camera.inputs.clear()

  // Build shellmap geometry
  buildShellmapScene(scene)
  infoMeshCount.textContent = String(meshCount)
  infoTriCount.textContent = String(totalTriangles)

  return true
}

// ---------------------------------------------------------------------------
// State Update Functions
// ---------------------------------------------------------------------------

function setShellmapActive(active: boolean): void {
  state.shellmapActive = active

  if (!canvas || !scene) return

  if (active) {
    canvas.className = 'visible'
    sandbox.style.backgroundColor = 'transparent'
    scene.clearColor.a = state.clearColorAlpha
    bgColorInfo.textContent = 'canvas 3D scene'
    modeLabel.textContent = 'shellmap'
    modeLabel.style.color = '#4caf50'
    btnToggleShellmap.textContent = '⊗ 停止 Shellmap (回退背景)'
    btnToggleShellmap.className = 'danger'
  } else {
    canvas.className = 'hidden'
    sandbox.style.backgroundColor = '#0d0d1a'
    bgColorInfo.textContent = '#0d0d1a (fallback)'
    modeLabel.textContent = 'fallback'
    modeLabel.style.color = '#aad'
    btnToggleShellmap.textContent = '▶ 启动 Shellmap'
    btnToggleShellmap.className = 'primary'
  }

  infoShellmapState.textContent = active ? 'on' : 'off'
  runAutoChecks()
}

function setOverlayVisible(visible: boolean): void {
  state.overlayVisible = visible
  updateOverlay()
  runAutoChecks()
}

function setOverlayOpacity(opacity: number): void {
  state.overlayOpacity = opacity
  opacityVal.textContent = opacity.toFixed(2)
  sliderOpacity.value = String(opacity)
  updateOverlay()
  runAutoChecks()
}

function setClearColorAlpha(alpha: number): void {
  state.clearColorAlpha = alpha
  clearColorVal.textContent = alpha.toFixed(2)
  sliderClearColor.value = String(alpha)
  if (scene) {
    scene.clearColor.a = alpha
  }
  runAutoChecks()
}

// ---------------------------------------------------------------------------
// Auto-checks
// ---------------------------------------------------------------------------

function runAutoChecks(): void {
  // Check 1: Canvas exists and has correct dimensions
  if (canvas && canvas.width > 0 && canvas.height > 0) {
    chkCanvasExists.className = 'check-indicator pass'
  } else {
    chkCanvasExists.className = canvas ? 'check-indicator pending' : 'check-indicator fail'
  }

  // Check 2: Shellmap rendering — active and FPS >= threshold
  const currentFps = fpsDisplay
  if (state.shellmapActive && currentFps >= 30) {
    chkShellmapRendering.className = 'check-indicator pass'
  } else if (state.shellmapActive && currentFps > 0) {
    chkShellmapRendering.className = 'check-indicator pending'
  } else if (!state.shellmapActive) {
    chkShellmapRendering.className = 'check-indicator' // N/A — not in shellmap mode
  } else {
    chkShellmapRendering.className = 'check-indicator fail'
  }

  // Check 3: Fallback color = #0d0d1a when shellmap is off
  if (!state.shellmapActive) {
    const sandboxBg = getComputedStyle(sandbox).backgroundColor
    // rgb(13, 13, 26) or #0d0d1a
    const isFallbackColor =
      sandboxBg === 'rgb(13, 13, 26)' ||
      sandboxBg === '#0d0d1a' ||
      sandboxBg === 'rgb(13,13,26)'
    chkFallbackColor.className = isFallbackColor ? 'check-indicator pass' : 'check-indicator fail'
  } else {
    chkFallbackColor.className = 'check-indicator' // N/A
  }

  // Check 4: Overlay opacity matches state
  const card = document.getElementById('menu-card')
  if (card && state.overlayVisible) {
    const cardBg = getComputedStyle(card).backgroundColor
    const expectedRgba = `rgba(10, 10, 30, ${state.overlayOpacity.toFixed(2)})`
    const expectedRgbaNoSpace = `rgba(10,10,30,${state.overlayOpacity.toFixed(2)})`
    chkOverlayOpacity.className =
      (cardBg === expectedRgba || cardBg === expectedRgbaNoSpace)
        ? 'check-indicator pass'
        : 'check-indicator pending'
  } else if (!state.overlayVisible) {
    chkOverlayOpacity.className = 'check-indicator' // N/A
  } else {
    chkOverlayOpacity.className = 'check-indicator pending'
  }

  // Check 5: Canvas z-index < overlay z-index
  if (canvas) {
    const canvasZ = parseInt(getComputedStyle(canvas).zIndex, 10) || 0
    const overlayZ = parseInt(getComputedStyle(menuOverlay!).zIndex, 10) || 0
    chkZOrder.className =
      canvasZ < overlayZ ? 'check-indicator pass' : 'check-indicator fail'
  } else {
    chkZOrder.className = 'check-indicator pending'
  }

  // Check 6: Transition CSS exists on canvas
  if (canvas) {
    const transition = getComputedStyle(canvas).transition
    chkTransition.className =
      transition.includes('opacity') ? 'check-indicator pass' : 'check-indicator fail'
  } else {
    chkTransition.className = 'check-indicator pending'
  }
}

// ---------------------------------------------------------------------------
// FPS Counter (shared with render loop)
// ---------------------------------------------------------------------------

let fpsFrames = 0
let fpsAccum = 0
let fpsDisplay = 0
let lastFpsUpdate = performance.now()
let animationTime = 0

// Store original Y positions for units to avoid cumulative drift during bob animation.
// Units are created by createUnit() which sets box.position.y = def.h / 2.
const unitOriginalY: Record<string, number> = {
  unit_tank1: 0.25, // h=0.5 → h/2 = 0.25
  unit_tank2: 0.25, // h=0.5 → h/2 = 0.25
  unit_harv: 0.35,  // h=0.7 → h/2 = 0.35
}

// ---------------------------------------------------------------------------
// Animation (simple orbit + unit movement)
// ---------------------------------------------------------------------------

function animateShellmap(timeDelta: number): void {
  if (!state.shellmapActive || !scene) return

  animationTime += timeDelta * 0.001 // Convert ms to seconds

  // Slow camera orbit
  if (camera) {
    camera.alpha = -Math.PI / 4 + animationTime * 0.15
  }

  // Animate units: slight bob and turret rotation.
  // Use absolute position calculation (origY + offset) to avoid cumulative drift
  // that would occur with mesh.position.y += delta.
  const unitBaseNames = ['unit_tank1', 'unit_tank2', 'unit_harv']
  const bobAmplitude = 0.04
  for (const name of unitBaseNames) {
    const mesh = scene.getMeshByName(name)
    if (mesh) {
      mesh.position.y = unitOriginalY[name] + bobAmplitude * Math.sin(animationTime * 2.5)
    }
    const turret = scene.getMeshByName(`${name}_turret`)
    if (turret) {
      turret.rotation.y = animationTime * 0.8
    }
  }
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  updateInfoBar()

  // Initialize engine (creates canvas, scene, shellmap meshes)
  const engineOk = initEngine()
  if (!engineOk) return

  // Set initial state: fallback mode
  setShellmapActive(false)
  setOverlayVisible(true)
  setOverlayOpacity(0.75)

  // Center overlay based on sandbox size
  centerOverlay()

  // Resize observer
  const resizeObserver = new ResizeObserver(() => {
    engine?.resize()
    centerOverlay()
    infoViewport.textContent = `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
    if (canvas) {
      const rect = sandbox.getBoundingClientRect()
      canvas.width = Math.max(rect.width || 800, 1)
      canvas.height = Math.max(rect.height || 600, 1)
    }
  })
  resizeObserver.observe(sandbox)

  // Render loop
  engine!.runRenderLoop(() => {
    const now = performance.now()
    const delta = now - lastFpsUpdate
    lastFpsUpdate = now

    fpsFrames++
    fpsAccum += delta

    if (fpsAccum >= 500) {
      fpsDisplay = Math.round((fpsFrames / fpsAccum) * 1000)
      fpsFrames = 0
      fpsAccum = 0
    }

    animateShellmap(delta)

    if (state.shellmapActive) {
      scene!.render()
    } else {
      // When shellmap is inactive, we still need to clear the canvas.
      // Scene.render() is skipped.  Babylon.js engine.beginFrame / endFrame
      // while the canvas is hidden still tick.
    }

    infoFps.textContent = String(fpsDisplay)
    infoTime.textContent = new Date().toISOString()

    // Update draw call count (available after scene render).
    // NOTE: _drawCalls is a private/undocumented Babylon.js Engine property
    // used here only for diagnostic monitoring in this manual test page.
    // It is not part of the public API and may change between engine versions.
    if (engine) {
      const dc = (engine as any)._drawCalls
      drawCalls = typeof dc?.current === 'number' ? dc.current as number : 0
      infoDrawCalls.textContent = String(drawCalls)
    }
    infoShellmapState.textContent = state.shellmapActive ? 'on' : 'off'
  })
}

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------

btnToggleShellmap.addEventListener('click', () => {
  setShellmapActive(!state.shellmapActive)
})

btnToggleOverlay.addEventListener('click', () => {
  setOverlayVisible(!state.overlayVisible)
})

btnTestTransition.addEventListener('click', async () => {
  // Rapid transition test: toggle shellmap 3 times with delays
  btnTestTransition.disabled = true
  btnTestTransition.textContent = '过渡测试中...'

  for (let i = 0; i < 3; i++) {
    setShellmapActive(true)
    await delay(600)
    setShellmapActive(false)
    await delay(600)
  }
  // End on shellmap active to leave it in a visible state
  setShellmapActive(true)
  await delay(600)

  btnTestTransition.disabled = false
  btnTestTransition.textContent = '↻ 测试背景过渡（快速切换）'
})

sliderOpacity.addEventListener('input', () => {
  setOverlayOpacity(parseFloat(sliderOpacity.value))
})

sliderClearColor.addEventListener('input', () => {
  setClearColorAlpha(parseFloat(sliderClearColor.value))
})

// ---------------------------------------------------------------------------
// Window resize → re-center overlay
// ---------------------------------------------------------------------------

window.addEventListener('resize', () => {
  centerOverlay()
  runAutoChecks()
})

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Test Harness (for Playwright/automated testing)
// ---------------------------------------------------------------------------

;(window as any).__testHarness = {
  getState: () => ({ ...state }),
  getFps: () => fpsDisplay,
  getCheckResults: () => ({
    canvasExists: chkCanvasExists.className.includes('pass'),
    shellmapRendering: chkShellmapRendering.className.includes('pass'),
    fallbackColor: chkFallbackColor.className.includes('pass'),
    overlayOpacity: chkOverlayOpacity.className.includes('pass'),
    zOrder: chkZOrder.className.includes('pass'),
    transition: chkTransition.className.includes('pass'),
  }),
  toggleShellmap: () => setShellmapActive(!state.shellmapActive),
  toggleOverlay: () => setOverlayVisible(!state.overlayVisible),
  setShellmapActive: (v: boolean) => setShellmapActive(v),
  setOverlayVisible: (v: boolean) => setOverlayVisible(v),
  setOverlayOpacity: (v: number) => setOverlayOpacity(v),
  getCanvas: () => canvas,
  getScene: () => scene,
  getEngine: () => engine,
  getMeshCount: () => meshCount,
  getTriangleCount: () => totalTriangles,
  getSandboxBg: () => getComputedStyle(sandbox).backgroundColor,
  testTransition: () => btnTestTransition.click(),
}

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------

main().catch((err: unknown) => {
  console.error('[fatal] main() failed:', err)
  const errorEl = document.getElementById('gpu-error')!
  errorEl.style.display = 'flex'
  errorEl.textContent = `初始化失败: ${err instanceof Error ? err.message : String(err)}`
})

if (import.meta.hot) {
  import.meta.hot.accept(() => {})
}
