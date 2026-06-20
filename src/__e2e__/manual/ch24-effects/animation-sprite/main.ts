/**
 * main.ts — AnimationStub ShaderMaterial + Sprite Sheet 人工验收测试
 *
 * 测试目标:
 *   1. ShaderMaterial + sprite sheet 纹理渲染正确性
 *   2. 逐帧 UV 更新（4 色象限帧切换）
 *   3. 无 Sheet 时的品红色 StandardMaterial fallback
 *   4. 预乘 Alpha 混合（半透明绿色帧透过背景棋盘格）
 *   5. renderingGroupId = RenderGroup.Actor (1)
 *
 * OpenRA 对照: AnimationStub (OpenRA.Graphics.Animation wrapper)
 * Ch24 Phase A: Material Integration
 */

import { Engine } from '@babylonjs/core'
import { Scene } from '@babylonjs/core'
import { ArcRotateCamera } from '@babylonjs/core'
import { HemisphericLight } from '@babylonjs/core'
import { Vector3 } from '@babylonjs/core'
import { Color3, Color4 } from '@babylonjs/core'
import { Constants } from '@babylonjs/core'
import { MeshBuilder } from '@babylonjs/core'
import { StandardMaterial } from '@babylonjs/core'
import type { Mesh } from '@babylonjs/core'

import { AnimationStub } from '../../../../OpenRA.Mods.Cnc/Effects/AnimationStub.js'
import { WPos } from '../../../../OpenRA.Game/WPos.js'
import { Sheet, SheetType } from '../../../../OpenRA.Game/Graphics/Sheet.js'

// ---------------------------------------------------------------------------
// Canvas 发现 / 创建
// ---------------------------------------------------------------------------

let canvas = document.querySelector('#sandbox canvas') as HTMLCanvasElement | null
if (!canvas) {
  canvas = document.createElement('canvas')
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.display = 'block'
  canvas.style.outline = 'none'
  canvas.style.touchAction = 'none'
  document.getElementById('sandbox')!.appendChild(canvas)
}

// ---------------------------------------------------------------------------
// Babylon.js 初始化
// ---------------------------------------------------------------------------

const engine = new Engine(canvas, true, {
  preserveDrawingBuffer: false,
  antialias: true,
})

const scene = new Scene(engine)
scene.clearColor = new Color4(0.05, 0.07, 0.12, 1.0)

// ---------------------------------------------------------------------------
// 摄像机 + 灯光
// ---------------------------------------------------------------------------

const camera = new ArcRotateCamera(
  'testCamera',
  -Math.PI / 4,
  Math.PI / 4,
  8,
  Vector3.Zero(),
  scene,
)
camera.lowerRadiusLimit = 3
camera.upperRadiusLimit = 20
camera.attachControl(canvas, true)

const light = new HemisphericLight('testLight', new Vector3(0, 1, 0), scene)
light.intensity = 0.8

// ---------------------------------------------------------------------------
// 背景棋盘格平面（用于 Alpha 混合验证）
// ---------------------------------------------------------------------------

const groundMat = new StandardMaterial('checkerMat', scene)
groundMat.backFaceCulling = false
groundMat.diffuseColor = new Color3(0.25, 0.25, 0.25)
groundMat.specularColor = Color3.Black()

const checkerboardPlane = MeshBuilder.CreatePlane(
  'checkerGround',
  { width: 10, height: 10 },
  scene,
)
checkerboardPlane.material = groundMat
checkerboardPlane.position.z = -0.55
checkerboardPlane.renderingGroupId = 0

// ---------------------------------------------------------------------------
// Sprite Sheet 生成 (4 帧 2x2 象限)
// ---------------------------------------------------------------------------

const SHEET_SIZE = 256
const HALF = SHEET_SIZE / 2

/**
 * 创建 4 帧 256x256 sprite sheet (BGRA 格式):
 *   Frame 0: 左上 (0,0)-(128,128)       — 红色 #FF0000, 完全不透明
 *   Frame 1: 右上 (128,0)-(256,128)     — 绿色 #00FF00, 50% 透明 (Alpha=128)
 *   Frame 2: 左下 (0,128)-(128,256)     — 蓝色 #0000FF, 完全不透明
 *   Frame 3: 右下 (128,128)-(256,256)   — 黄色 #FFFF00, 完全不透明
 *
 * Sheet 内部 CPU 端为 BGRA 格式，上传 GPU 时自动 swapRB 转为 RGBA。
 */
function createTestSheet(scene: Scene): Sheet {
  const sheet = new Sheet(
    SheetType.BGRA,
    { width: SHEET_SIZE, height: SHEET_SIZE },
    scene,
  )
  const data = sheet.getData() // Uint8Array, BGRA 像素布局

  for (let y = 0; y < SHEET_SIZE; y++) {
    for (let x = 0; x < SHEET_SIZE; x++) {
      const idx = (y * SHEET_SIZE + x) * 4
      const isLeft = x < HALF
      const isTop = y < HALF

      // BGRA 顺序: data[idx]=B, data[idx+1]=G, data[idx+2]=R, data[idx+3]=A
      if (isTop && isLeft) {
        // Red   — BGRA = [0, 0, 255, 255]
        data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 255; data[idx + 3] = 255
      } else if (isTop && !isLeft) {
        // Green 50% transparent — BGRA = [0, 255, 0, 128]
        data[idx] = 0; data[idx + 1] = 255; data[idx + 2] = 0; data[idx + 3] = 128
      } else if (!isTop && isLeft) {
        // Blue  — BGRA = [255, 0, 0, 255]
        data[idx] = 255; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 255
      } else {
        // Yellow — BGRA = [0, 255, 255, 255]
        data[idx] = 0; data[idx + 1] = 255; data[idx + 2] = 255; data[idx + 3] = 255
      }
    }
  }

  sheet.commitBufferedData()
  sheet.getTexture(scene) // 触发上传（含 BGRA→RGBA swapRB）
  return sheet
}

/**
 * 计算 4 帧的 UV 矩形: [uMin, vMin, uMax, vMax] (0..1 纹理空间)
 *
 * 对应 2x2 象限布局:
 *   Frame 0 (左上, Red):    [0,   0,   0.5, 0.5]
 *   Frame 1 (右上, Green):  [0.5, 0,   1.0, 0.5]
 *   Frame 2 (左下, Blue):   [0,   0.5, 0.5, 1.0]
 *   Frame 3 (右下, Yellow): [0.5, 0.5, 1.0, 1.0]
 */
function createFrameUVs(): Float32Array[] {
  return [
    new Float32Array([0, 0, 0.5, 0.5]),
    new Float32Array([0.5, 0, 1.0, 0.5]),
    new Float32Array([0, 0.5, 0.5, 1.0]),
    new Float32Array([0.5, 0.5, 1.0, 1.0]),
  ]
}

// ---------------------------------------------------------------------------
// 创建测试资源
// ---------------------------------------------------------------------------

const testSheet = createTestSheet(scene)
const frameUVs = createFrameUVs()
const dummyWorld = {}

// AnimationStub 实例（let — 支持 tickPerFrame 滑块重建）
let animWithSheet!: AnimationStub
let animNoSheet!: AnimationStub

/** 使用给定 tickPerFrame 创建（或重建）AnimationStub 实例 */
function rebuildAnimations(tickPerFrame: number): void {
  // Dispose old meshes + materials
  animWithSheet?.dispose()
  animNoSheet?.dispose()

  // Instance 1: With Sheet + frameUVs — 4 色帧循环 (ShaderMaterial)
  animWithSheet = new AnimationStub(
    dummyWorld,
    'test-sprite',
    4,
    tickPerFrame,
    testSheet,
    frameUVs,
    scene,
  )

  // Instance 2: Without Sheet — 品红色 fallback (StandardMaterial)
  animNoSheet = new AnimationStub(
    dummyWorld,
    'no-sheet',
    1,          // only 1 frame (no actual animation needed for fallback test)
    tickPerFrame,
    undefined,  // no Sheet
    undefined,  // no frameUVs
    scene,
  )

  // 启动动画（循环播放）
  animWithSheet.playRepeating('test-seq')
  animNoSheet.playRepeating('fallback-seq')

  // 重置 tick 累积器，避免重建后立即跳帧
  tickAccumulator = 0
}

// 初始创建（默认 tickPerFrame=1）
rebuildAnimations(1)

// ---------------------------------------------------------------------------
// 位置定义
// ---------------------------------------------------------------------------

// WPos 使用子格单位 (1024 = 1 cell)，这里将两个动画平面放在相机可见位置
const posWithSheet = new WPos(-1024, 0, 0)
const posNoSheet = new WPos(1024, 0, 0)

// ---------------------------------------------------------------------------
// 渲染状态
// ---------------------------------------------------------------------------

let isPlaying = true
let speedMultiplier = 1.0
let tickAccumulator = 0
const BASE_TICK_INTERVAL_MS = 40 // 25 ticks/s

let currentFrameWithSheet = 0
let currentTickWithSheet = 0

// 纹理参考预览平面（初始隐藏）
let refPlane: Mesh | null = null

// ---------------------------------------------------------------------------
// 渲染循环
// ---------------------------------------------------------------------------

engine.runRenderLoop(() => {
  if (isPlaying) {
    tickAccumulator += engine.getDeltaTime()
    const effectiveInterval = BASE_TICK_INTERVAL_MS / speedMultiplier

    while (tickAccumulator >= effectiveInterval) {
      tickAccumulator -= effectiveInterval

      animWithSheet.tick()
      animNoSheet.tick()

      currentFrameWithSheet = animWithSheet.currentFrame
      currentTickWithSheet = animWithSheet.currentTick
    }
  }

  // 调用 render 以创建/更新/定位 mesh
  animWithSheet.render(posWithSheet, null)
  animNoSheet.render(posNoSheet, null)

  // 更新 UI 状态
  updateUIState()
  document.getElementById('info-fps')!.textContent = engine.getFps().toFixed(0)

  scene.render()
})

// ---------------------------------------------------------------------------
// UI 状态更新
// ---------------------------------------------------------------------------

function updateUIState(): void {
  document.getElementById('state-frame')!.textContent = String(currentFrameWithSheet)
  document.getElementById('state-ticks')!.textContent = String(currentTickWithSheet)

  // 帧指示点
  const dots = document.querySelectorAll('#frame-dots .frame-dot')
  dots.forEach((dot, i) => {
    dot.classList.toggle('active', i === currentFrameWithSheet)
  })

  // Material 类型
  const mat = animWithSheet.material
  if (mat) {
    const className = (mat as any).getClassName?.() ?? 'Unknown'
    document.getElementById('state-material')!.textContent =
      className.includes('Shader') ? 'ShaderMaterial' : className
    document.getElementById('state-alpha')!.textContent =
      `ALPHA_PREMULTIPLIED (mode=${(mat as any).alphaMode})`
  } else {
    document.getElementById('state-material')!.textContent = 'null'
    document.getElementById('state-alpha')!.textContent = '-'
  }

  // renderingGroupId
  const mesh = animWithSheet.mesh
  document.getElementById('state-rendergroup')!.textContent =
    mesh ? String(mesh.renderingGroupId) : '-'
}

// ---------------------------------------------------------------------------
// 信息栏
// ---------------------------------------------------------------------------

function updateInfoBar(): void {
  const ua = navigator.userAgent
  document.getElementById('info-ua')!.textContent =
    ua.length > 60 ? ua.slice(0, 57) + '...' : ua
  document.getElementById('info-viewport')!.textContent =
    `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
  document.getElementById('info-engine')!.textContent =
    engine.webGLVersion >= 2 ? `WebGL ${engine.webGLVersion}.0` : 'Unknown'
  document.getElementById('info-time')!.textContent = new Date().toISOString()
}

// ---------------------------------------------------------------------------
// 控件绑定
// ---------------------------------------------------------------------------

document.getElementById('btn-play')!.addEventListener('click', () => {
  isPlaying = true
  document.getElementById('btn-play')!.classList.add('active')
  document.getElementById('btn-pause')!.classList.remove('active')
})

document.getElementById('btn-pause')!.addEventListener('click', () => {
  isPlaying = false
  document.getElementById('btn-play')!.classList.remove('active')
  document.getElementById('btn-pause')!.classList.add('active')
})

document.getElementById('btn-step')!.addEventListener('click', () => {
  isPlaying = false
  document.getElementById('btn-play')!.classList.remove('active')
  document.getElementById('btn-pause')!.classList.add('active')

  animWithSheet.tick()
  animNoSheet.tick()
  currentFrameWithSheet = animWithSheet.currentFrame
  currentTickWithSheet = animWithSheet.currentTick

  // 调用 render 更新 mesh UV 和位置
  animWithSheet.render(posWithSheet, null)
  animNoSheet.render(posNoSheet, null)
  updateUIState()
})

const speedSlider = document.getElementById('speed-slider') as HTMLInputElement
speedSlider.addEventListener('input', () => {
  speedMultiplier = parseFloat(speedSlider.value)
  document.getElementById('speed-val')!.textContent = speedMultiplier.toFixed(1) + 'x'
})

const tpfSlider = document.getElementById('tpf-slider') as HTMLInputElement
tpfSlider.addEventListener('input', () => {
  const tpf = parseInt(tpfSlider.value, 10)
  document.getElementById('tpf-val')!.textContent = String(tpf)
  rebuildAnimations(tpf)
})

// 纹理预览切换
document.getElementById('btn-show-sheet')!.addEventListener('click', () => {
  if (refPlane) {
    refPlane.dispose()
    refPlane = null
    return
  }

  refPlane = MeshBuilder.CreatePlane('sheetRef', { width: 3, height: 3 }, scene)
  refPlane.position.set(0, 0, 0.5)
  refPlane.renderingGroupId = 0

  const refMat = new StandardMaterial('sheetRefMat', scene)
  refMat.diffuseTexture = testSheet.getTexture(scene)
  refMat.backFaceCulling = false
  refMat.alphaMode = Constants.ALPHA_PREMULTIPLIED
  refPlane.material = refMat
})

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------

// 初始调用 render 以立即创建 mesh
animWithSheet.render(posWithSheet, null)
animNoSheet.render(posNoSheet, null)

updateInfoBar()
updateUIState()
document.getElementById('btn-play')!.classList.add('active')

window.addEventListener('resize', () => {
  document.getElementById('info-viewport')!.textContent =
    `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
})

setInterval(updateInfoBar, 2000)
