/**
 * main.ts — WorldRenderer Y-Sort 排序人工验收测试
 *
 * 测试目标:
 *   1. 验证 renderableZPositionComparisonKey 的排序公式：Z_key = Pos.Y + Pos.Z + ZOffset
 *   2. 验证排序键值对视觉叠放顺序的影响
 *   3. 验证 Y、Z、ZOffset 三个参数独立调节的效果
 *
 * OpenRA 对照: WorldRenderer.ts — renderableZPositionComparisonKey()
 */

import { Engine } from '@babylonjs/core'
import { Scene } from '@babylonjs/core'
import { ArcRotateCamera } from '@babylonjs/core'
import { HemisphericLight } from '@babylonjs/core'
import { Vector3 } from '@babylonjs/core'
import { Color3, Color4 } from '@babylonjs/core'
import { MeshBuilder } from '@babylonjs/core'
import { StandardMaterial } from '@babylonjs/core'
import { DynamicTexture } from '@babylonjs/core'

// ---------------------------------------------------------------------------
// 创建带排序键标注的精灵纹理
// ---------------------------------------------------------------------------

function createSpriteTex(name: string, r: number, g: number, b: number, scene: Scene): DynamicTexture {
  const size = 256
  const tex = new DynamicTexture(`sprite_${name}`, { width: size, height: size }, scene, false)
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D

  // 实心矩形
  ctx.fillStyle = `rgb(${r},${g},${b})`
  ctx.fillRect(0, 0, size, size)

  // 边框
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'
  ctx.lineWidth = 3
  ctx.strokeRect(5, 5, size - 10, size - 10)

  // 标签
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 40px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(name, size / 2, size / 2)

  tex.update(true)
  tex.hasAlpha = false
  return tex
}

// ---------------------------------------------------------------------------
// 标签纹理
// ---------------------------------------------------------------------------

function createLabelTex(text: string, scene: Scene): DynamicTexture {
  const tex = new DynamicTexture(`lab_${text}`, { width: 512, height: 64 }, scene, false)
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D
  ctx.clearRect(0, 0, 512, 64)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 28px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 256, 32)
  tex.update(true)
  return tex
}

// ---------------------------------------------------------------------------
// 排序键计算（与 OpenRA 一致）
// ---------------------------------------------------------------------------

function calcSortKey(y: number, z: number, zOffset: number): number {
  return y + z + zOffset
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

  // ---- 场景 ----
  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.08, 0.09, 0.12, 1)

  // ---- 正交摄像机 ----
  const camera = new ArcRotateCamera(
    'cam',
    -Math.PI / 2,
    Math.PI / 2,
    10,
    new Vector3(0, 0, 0),
    scene,
  )
  camera.mode = 1
  camera.orthoTop = 2.5
  camera.orthoBottom = -2.5
  camera.orthoLeft = -4
  camera.orthoRight = 4
  camera.inputs.clear()
  camera.inputs.addMouseWheel()

  // ---- 光照 ----
  const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
  light.intensity = 0.9

  // ---- 创建 3 个精灵（A=红, B=绿, C=蓝） ----
  const spriteDefs = [
    { name: 'A', color: { r: 200, g: 50, b: 50 }, baseY: -1.0 },
    { name: 'B', color: { r: 50, g: 180, b: 60 }, baseY: 0.0 },
    { name: 'C', color: { r: 50, g: 80, b: 200 }, baseY: 1.0 },
  ]

  interface SpritePlaneEntry {
    plane: ReturnType<typeof MeshBuilder.CreatePlane>
    def: { name: string; color: { r: number; g: number; b: number }; baseY: number }
    y: number
    z: number
    zOffset: number
  }
  const spritePlanes: SpritePlaneEntry[] = []

  for (const def of spriteDefs) {
    const tex = createSpriteTex(def.name, def.color.r, def.color.g, def.color.b, scene)
    const mat = new StandardMaterial(`mat_${def.name}`, scene)
    mat.diffuseTexture = tex
    mat.emissiveTexture = tex
    mat.emissiveColor = new Color3(1, 1, 1)
    mat.specularColor.set(0, 0, 0)
    mat.backFaceCulling = false
    mat.disableLighting = true

    const plane = MeshBuilder.CreatePlane(`sprite_${def.name}`, { width: 1.5, height: 1.3 }, scene)
    plane.position = new Vector3(0, def.baseY, 0)
    plane.material = mat
    plane.renderingGroupId = 1  // Actor 层

    spritePlanes.push({ plane, def, y: def.baseY, z: 0, zOffset: 0 })
  }

  // ---- 排序键标签 ----
  const sortKeyLabels: ReturnType<typeof MeshBuilder.CreatePlane>[] = []

  function createSortKeyLabel(x: number, y: number, text: string): void {
    const labTex = createLabelTex(text, scene)
    const labMat = new StandardMaterial(`skMat_${text}`, scene)
    labMat.diffuseTexture = labTex
    labMat.emissiveTexture = labTex
    labMat.emissiveColor = new Color3(1, 1, 1)
    labMat.specularColor.set(0, 0, 0)
    labMat.backFaceCulling = false
    labMat.disableLighting = true

    const lab = MeshBuilder.CreatePlane(`sk_${text}`, { width: 2, height: 0.3 }, scene)
    lab.position = new Vector3(x, y, 0)
    lab.material = labMat
    sortKeyLabels.push(lab)
  }

  function updateSortKeyLabels(): void {
    // 清理
    for (const l of sortKeyLabels) l.dispose()
    sortKeyLabels.length = 0

    const showKeys = (document.getElementById('show-sort-keys') as HTMLInputElement).checked
    if (!showKeys) return

    const yDelta = parseFloat((document.getElementById('y-slider') as HTMLInputElement).value)
    const zDelta = parseFloat((document.getElementById('z-slider') as HTMLInputElement).value)
    const zOffsetDelta = parseFloat((document.getElementById('zoffset-slider') as HTMLInputElement).value)

    for (const sp of spritePlanes) {
      const key = calcSortKey(sp.y + yDelta, sp.z + zDelta, sp.zOffset + zOffsetDelta)
      createSortKeyLabel(2.2, sp.y, `key=${key.toFixed(2)}`)
    }
  }

  // ---- 排序函数 ----
  function applySort(yDelta: number, zDelta: number, zOffsetDelta: number): void {
    // 更新 3D 位置
    for (const sp of spritePlanes) {
      const y = sp.def.baseY + yDelta
      const z = zDelta
      sp.plane.position.y = y
      sp.plane.position.z = z
    }

    // Y-sort: 按 sortKey 从小到大排列 → 小的在屏幕下方（先绘制）
    const sorted = [...spritePlanes].sort((a, b) => {
      const keyA = calcSortKey(a.def.baseY + yDelta, zDelta, zOffsetDelta)
      const keyB = calcSortKey(b.def.baseY + yDelta, zDelta, zOffsetDelta)
      return keyA - keyB
    })

    // 通过 renderingGroupId 的子分组实现排序
    // 设置 alphaIndex 控制绘制顺序
    for (let i = 0; i < sorted.length; i++) {
      sorted[i].plane.alphaIndex = i
    }

    // 更新 UI 状态
    document.getElementById('state-key-a')!.textContent = calcSortKey(
      spritePlanes[0].def.baseY + yDelta, zDelta, zOffsetDelta,
    ).toFixed(3)
    document.getElementById('state-key-b')!.textContent = calcSortKey(
      spritePlanes[1].def.baseY + yDelta, zDelta, zOffsetDelta,
    ).toFixed(3)
    document.getElementById('state-key-c')!.textContent = calcSortKey(
      spritePlanes[2].def.baseY + yDelta, zDelta, zOffsetDelta,
    ).toFixed(3)
    document.getElementById('state-order')!.textContent = sorted.map(s => s.def.name).join(' → ')

    updateSortKeyLabels()
  }

  // ---- UI 绑定 ----
  const ySlider = document.getElementById('y-slider') as HTMLInputElement
  const yVal = document.getElementById('y-val')!
  const zSlider = document.getElementById('z-slider') as HTMLInputElement
  const zVal = document.getElementById('z-val')!
  const zOffsetSlider = document.getElementById('zoffset-slider') as HTMLInputElement
  const zOffsetVal = document.getElementById('zoffset-val')!
  const showSortKeysCb = document.getElementById('show-sort-keys') as HTMLInputElement

  function updateAll(): void {
    const yD = parseFloat(ySlider.value)
    const zD = parseFloat(zSlider.value)
    const zoD = parseFloat(zOffsetSlider.value)
    yVal.textContent = yD.toFixed(2)
    zVal.textContent = zD.toFixed(2)
    zOffsetVal.textContent = zoD.toFixed(2)
    applySort(yD, zD, zoD)
  }

  ySlider.addEventListener('input', updateAll)
  zSlider.addEventListener('input', updateAll)
  zOffsetSlider.addEventListener('input', updateAll)
  showSortKeysCb.addEventListener('change', updateAll)

  document.getElementById('reset-params')!.addEventListener('click', () => {
    ySlider.value = '0'; zSlider.value = '0'; zOffsetSlider.value = '0'
    updateAll()
  })

  // ---- 图例 ----
  function createLegendItem(text: string, x: number, y: number, color: string): void {
    const mat = new StandardMaterial(`legm_${text}`, scene)
    // Create a small dot swatch
    const dotTex = new DynamicTexture(`dot_${text}`, { width: 16, height: 16 }, scene, false)
    const dctx = dotTex.getContext() as unknown as CanvasRenderingContext2D
    dctx.fillStyle = color
    dctx.fillRect(0, 0, 16, 16)
    dotTex.update(true)
    mat.diffuseTexture = dotTex
    mat.emissiveTexture = dotTex
    mat.emissiveColor = new Color3(1, 1, 1)
    mat.specularColor.set(0, 0, 0)
    mat.backFaceCulling = false
    mat.disableLighting = true

    const dot = MeshBuilder.CreatePlane(`dot_${text}`, { width: 0.2, height: 0.2 }, scene)
    dot.position = new Vector3(x, y, 0)
    dot.material = mat

    const labTex = createLabelTex(text, scene)
    const labMat = new StandardMaterial(`labm_${text}`, scene)
    labMat.diffuseTexture = labTex
    labMat.emissiveTexture = labTex
    labMat.emissiveColor = new Color3(1, 1, 1)
    labMat.specularColor.set(0, 0, 0)
    labMat.backFaceCulling = false
    labMat.disableLighting = true
    const lab = MeshBuilder.CreatePlane(`labPl_${text}`, { width: 1, height: 0.25 }, scene)
    lab.position = new Vector3(x + 0.6, y, 0)
    lab.material = labMat
  }

  createLegendItem('A (红)', -3.2, 1.5, 'rgb(200,50,50)')
  createLegendItem('B (绿)', -3.2, 0.8, 'rgb(50,180,60)')
  createLegendItem('C (蓝)', -3.2, 0.1, 'rgb(50,80,200)')

  // ---- 初始化 ----
  applySort(0, 0, 0)

  // ---- FPS 监控 ----
  let fpsFrames = 0
  let fpsAccum = 0
  let fpsDisplay = 0
  let lastFpsUpdate = performance.now()

  engine.runRenderLoop(() => {
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
}

main().catch((err: unknown) => {
  console.error('[fatal] main() failed:', err)
  const errorEl = document.getElementById('gpu-error')!
  errorEl.style.display = 'flex'
  errorEl.textContent = `初始化失败: ${err instanceof Error ? err.message : String(err)}`
})
