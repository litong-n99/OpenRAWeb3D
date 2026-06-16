/**
 * main.ts — SpriteRenderer Billboard 模式人工验收测试
 *
 * 测试目标:
 *   1. 验证 BILLBOARDMODE_Y 下精灵始终面向摄像机（仅 Y 轴旋转）
 *   2. 验证不同摄像机角度下 billboarding 的视觉正确性
 *   3. 验证精灵在网格中的相对位置关系保持不变
 *
 * OpenRA 对照: SpriteRenderer.cs ThinInstancesGroup (BILLBOARDMODE_Y)
 */

import { Engine } from '@babylonjs/core'
import { Scene } from '@babylonjs/core'
import { ArcRotateCamera } from '@babylonjs/core'
import { HemisphericLight } from '@babylonjs/core'
import { Vector3 } from '@babylonjs/core'
import { Color3, Color4 } from '@babylonjs/core'
import { MeshBuilder } from '@babylonjs/core'
import { Mesh } from '@babylonjs/core'
import { StandardMaterial } from '@babylonjs/core'
import { DynamicTexture } from '@babylonjs/core'
import { Tags } from '@babylonjs/core'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const GRID_SIZE = 5          // 5x5 网格
const GRID_SPACING = 2.5     // 精灵间距
const SPRITE_COUNT = GRID_SIZE * GRID_SIZE // 25 个精灵

// ---------------------------------------------------------------------------
// 辅助：创建箭头纹理（用于验证面向方向）
// ---------------------------------------------------------------------------

function createArrowTexture(name: string, color: Color3, scene: Scene): DynamicTexture {
  const size = 256
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, false)
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D
  const half = size / 2

  // 背景：半透明深色
  ctx.fillStyle = 'rgba(0,0,0,0.3)'
  ctx.fillRect(0, 0, size, size)

  // 彩色箭头指向右侧（精灵正面）
  ctx.save()
  ctx.translate(half, half)
  // 主箭头身体
  ctx.fillStyle = `rgb(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)})`
  ctx.beginPath()
  ctx.moveTo(-half * 0.7, -half * 0.2)
  ctx.lineTo(half * 0.2, -half * 0.2)
  ctx.lineTo(half * 0.2, -half * 0.5)
  ctx.lineTo(half * 0.7, 0)
  ctx.lineTo(half * 0.2, half * 0.5)
  ctx.lineTo(half * 0.2, half * 0.2)
  ctx.lineTo(-half * 0.7, half * 0.2)
  ctx.closePath()
  ctx.fill()

  // 边框
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'
  ctx.lineWidth = 2
  ctx.strokeRect(-half + 3, -half + 3, size - 6, size - 6)
  ctx.restore()

  tex.update(true)
  return tex
}

// ---------------------------------------------------------------------------
// 创建标签纹理
// ---------------------------------------------------------------------------

function createLabelTexture(name: string, text: string, scene: Scene): DynamicTexture {
  const w = 512, h = 128
  const tex = new DynamicTexture(name, { width: w, height: h }, scene, false)
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D
  ctx.fillStyle = 'rgba(0,0,0,0.1)'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 48px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, w / 2, h / 2)
  tex.update(true)
  return tex
}

function createLabelPlane(name: string, text: string, width: number, pos: Vector3, scene: Scene): Mesh {
  const tex = createLabelTexture(`labelTex_${name}`, text, scene)
  const mat = new StandardMaterial(`labelMat_${name}`, scene)
  mat.diffuseTexture = tex
  mat.emissiveTexture = tex
  mat.emissiveColor = new Color3(1, 1, 1)
  mat.specularColor.set(0, 0, 0)
  mat.backFaceCulling = false
  mat.disableLighting = true

  const plane = MeshBuilder.CreatePlane(`label_${name}`, { width, height: width * 0.25 }, scene)
  plane.position = pos
  plane.material = mat
  return plane
}

// ---------------------------------------------------------------------------
// 辅助：创建参考网格
// ---------------------------------------------------------------------------

function createGroundGrid(scene: Scene): void {
  const lines: Vector3[][] = []
  const half = (GRID_SIZE * GRID_SPACING) / 2
  const zOffset = -1

  for (let i = 0; i <= GRID_SIZE; i++) {
    const x = -half + i * GRID_SPACING
    lines.push([
      new Vector3(x, -half, zOffset),
      new Vector3(x, half, zOffset),
    ])
    lines.push([
      new Vector3(-half, i * GRID_SPACING - half, zOffset),
      new Vector3(half, i * GRID_SPACING - half, zOffset),
    ])
  }

  for (const [a, b] of lines) {
    MeshBuilder.CreateLines(`gridLine_${a.x}_${a.y}`, { points: [a, b] }, scene).color = new Color3(0.3, 0.3, 0.3)
  }
}

// ---------------------------------------------------------------------------
// 辅助：创建坐标轴
// ---------------------------------------------------------------------------

function createAxes(scene: Scene): void {
  const len = GRID_SIZE * GRID_SPACING * 0.6
  const y0 = -GRID_SIZE * GRID_SPACING * 0.4

  const axisX = MeshBuilder.CreateLines('axisX', { points: [new Vector3(0, y0, 0), new Vector3(len, y0, 0)] }, scene)
  axisX.color = new Color3(1, 0, 0)
  Tags.AddTagsTo(axisX, 'axisLine')

  const axisY = MeshBuilder.CreateLines('axisY', { points: [new Vector3(0, y0, 0), new Vector3(0, y0 + len, 0)] }, scene)
  axisY.color = new Color3(0, 1, 0)
  Tags.AddTagsTo(axisY, 'axisLine')

  const axisZ = MeshBuilder.CreateLines('axisZ', { points: [new Vector3(0, y0, 0), new Vector3(0, y0, len)] }, scene)
  axisZ.color = new Color3(0, 0, 1)
  Tags.AddTagsTo(axisZ, 'axisLine')

  const labelX = createLabelPlane('labelX', 'X (Red)', 2, new Vector3(len + 1.2, y0, 0), scene)
  Tags.AddTagsTo(labelX, 'axisLabel')
  const labelY = createLabelPlane('labelY', 'Y (Green)', 2, new Vector3(0, y0 + len + 1.2, 0), scene)
  Tags.AddTagsTo(labelY, 'axisLabel')
  const labelZ = createLabelPlane('labelZ', 'Z (Blue)', 2, new Vector3(0, y0, len + 1.2), scene)
  Tags.AddTagsTo(labelZ, 'axisLabel')
}

// ---------------------------------------------------------------------------
// 主函数
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // ---- 环境信息 ----
  const infoUa = document.getElementById('info-ua')!
  const infoViewport = document.getElementById('info-viewport')!
  const infoEngine = document.getElementById('info-engine')!
  const infoFps = document.getElementById('info-fps')!
  const infoTime = document.getElementById('info-time')!

  infoUa.textContent = navigator.userAgent.slice(0, 80)
  infoViewport.textContent = `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
  infoTime.textContent = new Date().toISOString()

  window.addEventListener('resize', () => {
    infoViewport.textContent = `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
  })

  // ---- Babylon.js 初始化 ----
  const sandboxEl = document.getElementById('sandbox')!
  const canvas = document.createElement('canvas')
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.width = Math.max(sandboxEl.getBoundingClientRect().width || 800, 1)
  canvas.height = Math.max(sandboxEl.getBoundingClientRect().height || 600, 1)
  sandboxEl.appendChild(canvas)

  let engine: Engine
  try {
    engine = new Engine(canvas, true, {
      preserveDrawingBuffer: false,
      stencil: false,
      antialias: false,
    })
  } catch {
    document.getElementById('gpu-error')!.style.display = 'flex'
    infoEngine.textContent = 'UNAVAILABLE'
    return
  }
  infoEngine.textContent = `Babylon.js v${Engine.Version} / WebGL ${engine.webGLVersion}.0`

  // ---- 场景创建 ----
  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.08, 0.09, 0.12, 1)

  // ---- 摄像机 (ArcRotateCamera, RTS 默认视角) ----
  const camera = new ArcRotateCamera(
    'cam',
    -Math.PI / 2,   // alpha: -90° — 从 +Z 方向看
    Math.PI / 2.5,  // beta: 约 72° — RTS 视角俯仰
    12,             // radius
    new Vector3(0, 0, 0),
    scene,
  )
  camera.lowerRadiusLimit = 3
  camera.upperRadiusLimit = 30
  camera.panningSensibility = 300
  camera.attachControl(canvas, true)

  // ---- 光照 ----
  const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
  light.intensity = 0.9

  // ---- 地面网格和坐标轴 ----
  createGroundGrid(scene)
  createAxes(scene)

  // ---- 创建精灵网格 ----
  const sprites: Mesh[] = []
  const half = (GRID_SIZE * GRID_SPACING) / 2

  // 颜色调色板（红橙黄绿青蓝紫 + 灰度）
  const palette: Color3[] = [
    new Color3(0.95, 0.2, 0.2),   // 红
    new Color3(0.95, 0.5, 0.2),   // 橙
    new Color3(0.95, 0.8, 0.2),   // 黄
    new Color3(0.3, 0.9, 0.3),    // 绿
    new Color3(0.2, 0.7, 0.9),    // 青
    new Color3(0.3, 0.4, 0.95),   // 蓝
    new Color3(0.7, 0.3, 0.95),   // 紫
    new Color3(0.5, 0.5, 0.5),    // 灰
  ]

  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const x = -half + col * GRID_SPACING
      const y = -half + row * GRID_SPACING
      const color = palette[(row + col) % palette.length]

      // 创建箭头纹理
      const tex = createArrowTexture(`arrow_${row}_${col}`, color, scene)

      // 创建材质
      const mat = new StandardMaterial(`spriteMat_${row}_${col}`, scene)
      mat.diffuseTexture = tex
      mat.emissiveTexture = tex
      mat.emissiveColor = new Color3(1, 1, 1)
      mat.useAlphaFromDiffuseTexture = true
      mat.specularColor.set(0, 0, 0)
      mat.backFaceCulling = false
      mat.disableLighting = true

      // 创建平面（精灵）
      const size = 1.2
      const plane = MeshBuilder.CreatePlane(
        `sprite_${row}_${col}`,
        { width: size, height: size },
        scene,
      )
      plane.position = new Vector3(x, y, 0)
      plane.billboardMode = Mesh.BILLBOARDMODE_Y
      plane.material = mat

      sprites.push(plane)
    }
  }

  // ---- 精灵网格标签（标注 5x5 网格 = 25 个精灵） ----
  const gridLabelTex = createLabelTexture('gridLabelTex', 'SPRITES (5×5) — BILLBOARDMODE_Y', scene)
  const gridLabelMat = new StandardMaterial('gridLabelMat', scene)
  gridLabelMat.diffuseTexture = gridLabelTex
  gridLabelMat.emissiveTexture = gridLabelTex
  gridLabelMat.emissiveColor = new Color3(1, 1, 1)
  gridLabelMat.specularColor.set(0, 0, 0)
  gridLabelMat.backFaceCulling = false
  gridLabelMat.disableLighting = true
  const gridLabel = MeshBuilder.CreatePlane('gridLabel', { width: 7, height: 0.7 }, scene)
  gridLabel.position = new Vector3(0, half + 1.6, 0)
  gridLabel.material = gridLabelMat
  gridLabel.billboardMode = Mesh.BILLBOARDMODE_ALL
  Tags.AddTagsTo(gridLabel, 'gridLabel')

  // ---- 地面参照平面（无 billboard，用于对比） ----
  const refTex = createArrowTexture('refArrow', new Color3(0.9, 0.2, 0.2), scene)
  const refMat = new StandardMaterial('refMat', scene)
  refMat.diffuseTexture = refTex
  refMat.emissiveTexture = refTex
  refMat.emissiveColor = new Color3(1, 1, 1)
  refMat.useAlphaFromDiffuseTexture = true
  refMat.specularColor.set(0, 0, 0)
  refMat.backFaceCulling = false
  refMat.disableLighting = true

  const refPlane = MeshBuilder.CreatePlane('refPlane', { width: 2, height: 2 }, scene)
  refPlane.position = new Vector3(-half - 2.5, -half, 0)
  refPlane.material = refMat
  // 无 billboard — 始终固定朝向

  const refLabelTex = createLabelTexture('refLabelTex', 'NO BILLBOARD (参照)', scene)
  const refLabelMat = new StandardMaterial('refLabelMat', scene)
  refLabelMat.diffuseTexture = refLabelTex
  refLabelMat.emissiveTexture = refLabelTex
  refLabelMat.emissiveColor = new Color3(1, 1, 1)
  refLabelMat.specularColor.set(0, 0, 0)
  refLabelMat.backFaceCulling = false
  refLabelMat.disableLighting = true
  const refLabel = MeshBuilder.CreatePlane('refLabel', { width: 2.5, height: 0.5 }, scene)
  refLabel.position = new Vector3(-half - 2.5, -half - 1.5, 0)
  refLabel.material = refLabelMat
  refLabel.billboardMode = Mesh.BILLBOARDMODE_ALL // 标签始终面向相机
  Tags.AddTagsTo(refLabel, 'spriteLabel')
  Tags.AddTagsTo(gridLabel, 'spriteLabel')

  // ---- UI 绑定 ----
  const alphaSlider = document.getElementById('alpha-slider') as HTMLInputElement
  const betaSlider = document.getElementById('beta-slider') as HTMLInputElement
  const radiusSlider = document.getElementById('radius-slider') as HTMLInputElement
  const alphaVal = document.getElementById('alpha-val')!
  const betaVal = document.getElementById('beta-val')!
  const radiusVal = document.getElementById('radius-val')!
  const billboardModeSel = document.getElementById('billboard-mode') as HTMLSelectElement
  const showAxesCb = document.getElementById('show-axes') as HTMLInputElement
  const showGridCb = document.getElementById('show-grid') as HTMLInputElement
  const showLabelsCb = document.getElementById('show-labels') as HTMLInputElement
  const resetCamBtn = document.getElementById('reset-cam') as HTMLButtonElement
  const autoRotateCb = document.getElementById('auto-rotate') as HTMLInputElement
  const stateSprites = document.getElementById('state-sprites')!
  const stateAlpha = document.getElementById('state-alpha')!
  const stateBeta = document.getElementById('state-beta')!
  const stateRot = document.getElementById('state-rot')!

  stateSprites.textContent = String(SPRITE_COUNT)

  function updateCameraFromSliders(): void {
    const alphaDeg = parseFloat(alphaSlider.value)
    const betaDeg = parseFloat(betaSlider.value)
    const radius = parseFloat(radiusSlider.value)
    camera.alpha = (alphaDeg * Math.PI) / 180
    camera.beta = (betaDeg * Math.PI) / 180
    camera.radius = radius
    alphaVal.textContent = `${alphaDeg}°`
    betaVal.textContent = `${betaDeg}°`
    radiusVal.textContent = radius.toFixed(1)
    stateAlpha.textContent = `${alphaDeg}°`
    stateBeta.textContent = `${betaDeg}°`
    // 显示第一个精灵的 Z 旋转参考
    const rotDeg = (sprites[0]?.rotation?.z ?? 0) * 180 / Math.PI
    stateRot.textContent = `${rotDeg.toFixed(1)}°`
  }

  alphaSlider.addEventListener('input', updateCameraFromSliders)
  betaSlider.addEventListener('input', updateCameraFromSliders)
  radiusSlider.addEventListener('input', updateCameraFromSliders)

  billboardModeSel.addEventListener('change', () => {
    const mode = billboardModeSel.value
    const babylonMode = mode === 'Y' ? Mesh.BILLBOARDMODE_Y
      : mode === 'ALL' ? Mesh.BILLBOARDMODE_ALL
        : Mesh.BILLBOARDMODE_NONE
    for (const sprite of sprites) {
      sprite.billboardMode = babylonMode
    }
  })

  showAxesCb.addEventListener('change', () => {
    const visible = showAxesCb.checked
    scene.getMeshesByTags('axisLine').forEach(m => m.isVisible = visible)
    scene.getMeshesByTags('axisLabel').forEach(m => m.isVisible = visible)
  })

  showGridCb.addEventListener('change', () => {
    const visible = showGridCb.checked
    scene.meshes.forEach(m => {
      if (m.name.startsWith('gridLine_')) {
        m.isVisible = visible
      }
    })
  })

  showLabelsCb.addEventListener('change', () => {
    const visible = showLabelsCb.checked
    scene.getMeshesByTags('spriteLabel').forEach(m => m.isVisible = visible)
  })

  resetCamBtn.addEventListener('click', () => {
    alphaSlider.value = '-90'
    betaSlider.value = '72'
    radiusSlider.value = '12'
    updateCameraFromSliders()
  })

  let autoRotateActive = false
  autoRotateCb.addEventListener('change', () => {
    autoRotateActive = autoRotateCb.checked
  })

  // ---- FPS 监控 + 渲染循环 ----
  let fpsFrames = 0
  let fpsAccum = 0
  let fpsDisplay = 0
  let lastFpsUpdate = performance.now()

  engine.runRenderLoop(() => {
    if (autoRotateActive) {
      camera.alpha += 0.003
      alphaSlider.value = String(Math.round((camera.alpha * 180 / Math.PI) % 360))
      alphaVal.textContent = `${alphaSlider.value}°`
      stateAlpha.textContent = `${alphaSlider.value}°`
    }

    scene.render()

    const now = performance.now()
    fpsFrames++
    fpsAccum += now - lastFpsUpdate
    lastFpsUpdate = now

    if (fpsAccum >= 500) {
      fpsDisplay = Math.round((fpsFrames / fpsAccum) * 1000)
      fpsFrames = 0
      fpsAccum = 0
    }
    infoFps.textContent = String(fpsDisplay)
    infoTime.textContent = new Date().toISOString()
  })

  const resizeObserver = new ResizeObserver(() => {
    engine.resize()
    infoViewport.textContent = `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
  })
  resizeObserver.observe(canvas)

  // 初始化显示
  updateCameraFromSliders()
}

main().catch((err: unknown) => {
  console.error('[fatal] main() failed:', err)
  const errorEl = document.getElementById('gpu-error')!
  errorEl.style.display = 'flex'
  errorEl.textContent = `初始化失败: ${err instanceof Error ? err.message : String(err)}`
})
