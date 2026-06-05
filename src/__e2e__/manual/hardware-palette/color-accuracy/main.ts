/**
 * main.ts — HardwarePalette 调色板颜色精度与 PlayerColorRemap 人工验收测试
 *
 * 测试目标:
 *   1. 验证调色板 256 色在渲染时的颜色精度（BGRA→RGBA 字节交换正确性）
 *   2. 验证 PlayerColorRemap 的 HSV 重映射视觉效果
 *   3. 验证 DynamicTexture 渲染的 FPS 稳定性
 *
 * OpenRA 对照: HardwarePalette.cs, PlayerColorRemap.cs, Palette.cs, Color.ts
 */

import { Engine } from '@babylonjs/core'
import { Scene } from '@babylonjs/core'
import { ArcRotateCamera } from '@babylonjs/core'
import { HemisphericLight } from '@babylonjs/core'
import { Vector3 } from '@babylonjs/core'
import { Color3 } from '@babylonjs/core'
import { MeshBuilder } from '@babylonjs/core'
import { StandardMaterial } from '@babylonjs/core'
import { DynamicTexture } from '@babylonjs/core'

import { ImmutablePalette, PALETTE_SIZE } from '../../../../OpenRA.Game/Graphics/Palette'
import type { IPalette } from '../../../../OpenRA.Game/Graphics/Palette'
import { PlayerColorRemap } from '../../../../OpenRA.Game/Graphics/PlayerColorRemap'
import { fromArgb, toArgb } from '../../../../OpenRA.Game/Primitives/Color'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 网格维度：16x16 = 256 色 */
const GRID_COLS = 16
const GRID_ROWS = 16
/** 每个色块的像素尺寸 */
const CELL_SIZE = 36
/** 纹理总尺寸（含边距） */
const TEX_WIDTH = GRID_COLS * CELL_SIZE  // 576
const TEX_HEIGHT = GRID_ROWS * CELL_SIZE  // 576

// ---------------------------------------------------------------------------
// 调色板工厂函数
// ---------------------------------------------------------------------------

/**
 * 创建合成渐变调色板（R→G→B 三色带 + 白色末尾）。
 *
 * 索引分配:
 *   0-84:   红色渐变 (0→255)
 *   85-169: 绿色渐变 (0→255)
 *   170-254: 蓝色渐变 (0→255)
 *   255:     白色 (255,255,255)
 */
function createGradientPalette(): ImmutablePalette {
  const colors = new Uint32Array(PALETTE_SIZE)
  for (let i = 0; i < 255; i++) {
    let r = 0, g = 0, b = 0
    if (i < 85) {
      r = Math.round((i / 84) * 255)
    } else if (i < 170) {
      g = Math.round(((i - 85) / 84) * 255)
    } else {
      b = Math.round(((i - 170) / 84) * 255)
    }
    colors[i] = toArgb(255, r, g, b)
  }
  colors[255] = toArgb(255, 255, 255, 255)
  return ImmutablePalette.fromColors(colors)
}

/**
 * 创建已知参考色调色板 — 50 个精确 ARGB 颜色散布在 256 个槽位中。
 *
 * 用于验证 BGRA→RGBA 字节交换：若字节序错误，红色和蓝色通道会互换。
 * 剩余槽位填充为深灰色 (#1a1a1a) 以突出显示参考色。
 */
function createReferencePalette(): ImmutablePalette {
  const colors = new Uint32Array(PALETTE_SIZE)
  for (let i = 0; i < PALETTE_SIZE; i++) {
    colors[i] = toArgb(255, 26, 26, 26)
  }

  const refs: [number, number, number, number, number][] = [
    [0,   255, 0,   0,   0],
    [1,   255, 255, 0,   0],
    [2,   255, 0,   255, 0],
    [3,   255, 0,   0,   255],
    [4,   255, 255, 255, 255],
    [10,  255, 255, 255, 0],
    [11,  255, 0,   255, 255],
    [12,  255, 255, 0,   255],
    [20,  255, 128, 128, 128],
    [21,  255, 64,  64,  64],
    [22,  255, 192, 192, 192],
    [30,  255, 128, 0,   0],
    [31,  255, 0,   128, 0],
    [32,  255, 0,   0,   128],
    [40,  255, 255, 128, 0],
    [41,  255, 128, 0,   255],
    [50,  128, 255, 0,   0],
    [51,  128, 0,   255, 0],
    [52,  128, 0,   0,   255],
    [60,  0,   0,   0,   0],
    [176, 255, 180, 180, 210],
    [177, 255, 160, 160, 200],
    [178, 255, 140, 140, 180],
    [179, 255, 120, 120, 170],
    [180, 255, 100, 100, 160],
    [181, 255, 90,  90,  150],
    [182, 255, 80,  80,  140],
    [183, 255, 70,  70,  130],
    [184, 255, 200, 180, 160],
    [185, 255, 190, 170, 150],
    [186, 255, 180, 160, 140],
    [187, 255, 170, 150, 130],
    [188, 255, 160, 140, 120],
    [189, 255, 150, 130, 110],
    [190, 255, 140, 120, 100],
    [191, 255, 130, 110, 90],
    [200, 255, 255, 0,   128],
    [210, 255, 0,   128, 128],
    [220, 255, 128, 128, 0],
    [240, 255, 0,   255, 128],
    [250, 255, 255, 128, 128],
  ]

  for (const [idx, a, r, g, b] of refs) {
    colors[idx] = toArgb(a, r, g, b)
  }

  return ImmutablePalette.fromColors(colors)
}

/**
 * 创建模拟 C&C Tiberian Dawn 风格的调色板。
 */
function createCCTDPalette(): ImmutablePalette {
  const colors = new Uint32Array(PALETTE_SIZE)

  for (let i = 0; i < 16; i++) {
    const v = Math.round((i / 15) * 40)
    colors[i] = toArgb(255, v, v, v)
  }
  for (let i = 0; i < 16; i++) {
    const t = i / 15
    colors[16 + i] = toArgb(255,
      Math.round(80 + t * 80),
      Math.round(50 + t * 60),
      Math.round(20 + t * 30),
    )
  }
  for (let i = 0; i < 32; i++) {
    const t = i / 31
    colors[32 + i] = toArgb(255,
      Math.round(20 + t * 30),
      Math.round(60 + t * 120),
      Math.round(10 + t * 40),
    )
  }
  for (let i = 0; i < 32; i++) {
    const t = i / 31
    colors[64 + i] = toArgb(255,
      Math.round(10 + t * 20),
      Math.round(30 + t * 60),
      Math.round(80 + t * 150),
    )
  }
  for (let i = 0; i < 32; i++) {
    const t = i / 31
    const v = Math.round(60 + t * 160)
    colors[96 + i] = toArgb(255, v, v, v)
  }
  for (let i = 0; i < 32; i++) {
    const t = i / 31
    colors[128 + i] = toArgb(255,
      Math.round(180 + t * 75),
      Math.round(140 + t * 80),
      Math.round(80 + t * 60),
    )
  }
  for (let i = 0; i < 16; i++) {
    const t = i / 15
    colors[160 + i] = toArgb(255,
      255,
      Math.round(200 - t * 150),
      Math.round(50 - t * 40),
    )
  }
  for (let i = 0; i < 16; i++) {
    const t = i / 15
    colors[176 + i] = toArgb(255,
      Math.round(200 - t * 80),
      Math.round(200 - t * 80),
      Math.round(220 - t * 80),
    )
  }
  for (let i = 0; i < 32; i++) {
    const t = i / 31
    colors[192 + i] = toArgb(255,
      Math.round(80 + t * 120),
      Math.round(10 + t * 40),
      Math.round(80 + t * 120),
    )
  }
  for (let i = 0; i < 31; i++) {
    const t = i / 30
    colors[224 + i] = toArgb(255,
      Math.round(200 + t * 55),
      Math.round(180 + t * 75),
      Math.round(100 + t * 155),
    )
  }
  colors[255] = toArgb(255, 255, 255, 255)

  return ImmutablePalette.fromColors(colors)
}

// ---------------------------------------------------------------------------
// 纹理绘制
// ---------------------------------------------------------------------------

/**
 * 将调色板绘制到 DynamicTexture 的 2D canvas 上，呈现为 16x16 色块网格。
 */
function drawPaletteToCanvas(
  ctx: CanvasRenderingContext2D,
  palette: IPalette,
  showIndices: boolean,
  showGrid: boolean,
): void {
  ctx.clearRect(0, 0, TEX_WIDTH, TEX_HEIGHT)

  for (let i = 0; i < PALETTE_SIZE; i++) {
    const col = i % GRID_COLS
    const row = Math.floor(i / GRID_COLS)
    const x = col * CELL_SIZE
    const y = row * CELL_SIZE

    const { r, g, b, a } = fromArgb(palette.at(i))

    if (a < 255) {
      ctx.fillStyle = '#333'
      ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE)
      const half = CELL_SIZE / 2
      ctx.fillStyle = '#555'
      ctx.fillRect(x, y, half, half)
      ctx.fillRect(x + half, y + half, half, half)
    }

    ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`
    ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE)

    if (showGrid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.lineWidth = 0.5
      ctx.strokeRect(x + 0.25, y + 0.25, CELL_SIZE - 0.5, CELL_SIZE - 0.5)
    }

    if (showIndices) {
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b
      ctx.fillStyle = luminance > 140 ? '#000' : '#fff'
      ctx.font = '10px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(i), x + CELL_SIZE / 2, y + CELL_SIZE / 2)
    }
  }
}

/**
 * 从 Babylon.js DynamicTexture 获取原生 CanvasRenderingContext2D。
 */
function getCanvasCtx(texture: DynamicTexture): CanvasRenderingContext2D {
  return texture.getContext() as unknown as CanvasRenderingContext2D
}

/**
 * 验证 canvas 像素是否包含预期的颜色数据。
 * 读取坐标 (cellPixelX, cellPixelY) 处的一个像素并记录其 RGBA 值。
 */
function verifyCanvasPixel(
  ctx: CanvasRenderingContext2D,
  label: string,
  cellPixelX: number,
  cellPixelY: number,
): void {
  try {
    const pixel = ctx.getImageData(cellPixelX, cellPixelY, 1, 1).data
    console.log(`[verify-canvas] ${label}: pixel@(${cellPixelX},${cellPixelY}) = rgba(${pixel[0]},${pixel[1]},${pixel[2]},${pixel[3]})`)
  } catch (err) {
    console.error(`[verify-canvas] ${label}: getImageData failed`, err)
  }
}

/**
 * 更新 DynamicTexture 的内容。
 */
function updateTexture(
  texture: DynamicTexture,
  palette: IPalette,
  showIndices: boolean,
  showGrid: boolean,
  verify: boolean,
): void {
  const texName = texture.name
  try {
    const ctx = getCanvasCtx(texture)
    if (!ctx) {
      console.error(`[updateTexture] ${texName}: getContext returned null`)
      return
    }
    drawPaletteToCanvas(ctx, palette, showIndices, showGrid)

    // 验证 canvas 像素：index 0 (纯黑 #000000) 的中心点位于 (18, 18)
    if (verify) {
      verifyCanvasPixel(ctx, texName, CELL_SIZE / 2, CELL_SIZE / 2)
      // 验证 index 1 (纯红 #ff0000) 的中心点位于 (18+36, 18) = (54, 18)
      verifyCanvasPixel(ctx, texName, CELL_SIZE + CELL_SIZE / 2, CELL_SIZE / 2)
    }

    // 使用 invertY=true：Canvas 2D 原点在左上角，WebGL 纹理原点在左下角，
    // 必须翻转 Y 轴才能正确显示
    texture.update(true)
    console.log(`[updateTexture] ${texName}: OK ${texture.getSize().width}x${texture.getSize().height}`)
  } catch (err) {
    console.error(`[updateTexture] ${texName}: failed`, err)
  }
}

// ---------------------------------------------------------------------------
// 材质工厂：创建具有纹理的 unlit 材质
// ---------------------------------------------------------------------------

const WHITE = new Color3(1, 1, 1)

function createTextureMaterial(
  name: string,
  texture: DynamicTexture,
  scene: Scene,
): StandardMaterial {
  const mat = new StandardMaterial(name, scene)
  mat.diffuseTexture = texture
  mat.emissiveTexture = texture    // unlit 模式下备用：若 disableLighting 忽略 diffuse，emissive 可兜底
  mat.emissiveColor = WHITE
  mat.specularColor.set(0, 0, 0)
  mat.backFaceCulling = false
  mat.disableLighting = true
  return mat
}

// ---------------------------------------------------------------------------
// 主函数
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // ---- 环境信息采集 ----
  const infoUa = document.getElementById('info-ua')!
  const infoViewport = document.getElementById('info-viewport')!
  const infoEngine = document.getElementById('info-engine')!
  const infoFps = document.getElementById('info-fps')!
  const infoFrameTime = document.getElementById('info-frame-time')!
  const infoPalRows = document.getElementById('info-pal-rows')!
  const infoTime = document.getElementById('info-time')!

  infoUa.textContent = navigator.userAgent.slice(0, 80)
  infoViewport.textContent = `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
  infoTime.textContent = new Date().toISOString()

  const updateViewport = (): void => {
    infoViewport.textContent = `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
  }
  window.addEventListener('resize', updateViewport)

  // ---- Babylon.js 初始化 ----
  const sandboxEl = document.getElementById('sandbox')!
  const canvas = document.createElement('canvas')
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  // 在创建 Engine 前设置 canvas 绘制缓冲区尺寸，匹配容器大小
  const sandboxRect = sandboxEl.getBoundingClientRect()
  canvas.width = Math.max(sandboxRect.width || 800, 1)
  canvas.height = Math.max(sandboxRect.height || 600, 1)
  console.log(`[init] canvas buffer size: ${canvas.width}x${canvas.height}`)
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

  const webGlVersion = engine.webGLVersion
  console.log(`[init] Engine: Babylon.js v${Engine.Version} / WebGL ${webGlVersion}.0`)
  infoEngine.textContent = `Babylon.js v${Engine.Version} / WebGL ${webGlVersion}.0`

  // ---- 场景创建 ----
  const scene = new Scene(engine)
  scene.clearColor.set(0.1, 0.11, 0.14, 1)

  // ---- 正交相机 ----
  // Babylon.js ArcRotateCamera: alpha=0 -> +X, alpha=PI/2 -> +Z
  const camera = new ArcRotateCamera(
    'cam',
    Math.PI / 2,       // alpha: PI/2 -> 相机在 +Z 轴上
    Math.PI / 2,       // beta: PI/2 = 水平视角（赤道）
    8,                 // radius
    new Vector3(0, 0, 0),
    scene,
  )
  camera.mode = 1 // ORTHOGRAPHIC_CAMERA
  camera.lowerRadiusLimit = 3
  camera.upperRadiusLimit = 30
  camera.panningSensibility = 200
  camera.inputs.clear()
  camera.inputs.addMouseWheel()

  console.log(`[init] Camera: pos=(${camera.position.x.toFixed(2)},${camera.position.y.toFixed(2)},${camera.position.z.toFixed(2)}) alpha=${camera.alpha.toFixed(2)} beta=${camera.beta.toFixed(2)} radius=${camera.radius}`)

  // ---- 光照 (StandardMaterial 兼容，虽然 disableLighting=true 不受影响) ----
  const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
  light.intensity = 0.9

  // ---- 创建两个纹理平面 ----
  // 左侧：原始调色板
  const texOriginal = new DynamicTexture(
    'texOriginal',
    { width: TEX_WIDTH, height: TEX_HEIGHT },
    scene,
    false, // no mipmap
  )
  const matOriginal = createTextureMaterial('matOriginal', texOriginal, scene)

  const planeOriginal = MeshBuilder.CreatePlane(
    'planeOriginal',
    { width: 4, height: 4 },
    scene,
  )
  planeOriginal.position.x = -2.2
  planeOriginal.position.y = 0
  planeOriginal.material = matOriginal

  // 标签 "ORIGINAL PALETTE"
  const labelOrigPlane = MeshBuilder.CreatePlane(
    'labelOrig',
    { width: 2.5, height: 0.4 },
    scene,
  )
  labelOrigPlane.position.x = -2.2
  labelOrigPlane.position.y = -2.3
  const labelOrigTex = new DynamicTexture(
    'labelOrigTex',
    { width: 512, height: 64 },
    scene,
    false,
  )
  const labelOrigCtx = getCanvasCtx(labelOrigTex)
  labelOrigCtx.fillStyle = '#1a1a2e'
  labelOrigCtx.fillRect(0, 0, 512, 64)
  labelOrigCtx.fillStyle = '#e94560'
  labelOrigCtx.font = 'bold 32px monospace'
  labelOrigCtx.textAlign = 'center'
  labelOrigCtx.textBaseline = 'middle'
  labelOrigCtx.fillText('ORIGINAL PALETTE', 256, 32)
  labelOrigTex.update(true)
  const labelOrigMat = createTextureMaterial('labelOrigMat', labelOrigTex, scene)
  labelOrigPlane.material = labelOrigMat

  // 右侧：重映射后调色板
  const texRemapped = new DynamicTexture(
    'texRemapped',
    { width: TEX_WIDTH, height: TEX_HEIGHT },
    scene,
    false,
  )
  const matRemapped = createTextureMaterial('matRemapped', texRemapped, scene)

  const planeRemapped = MeshBuilder.CreatePlane(
    'planeRemapped',
    { width: 4, height: 4 },
    scene,
  )
  planeRemapped.position.x = 2.2
  planeRemapped.position.y = 0
  planeRemapped.material = matRemapped

  // 标签 "REMAPPED PALETTE"
  const labelRmpPlane = MeshBuilder.CreatePlane(
    'labelRmp',
    { width: 2.5, height: 0.4 },
    scene,
  )
  labelRmpPlane.position.x = 2.2
  labelRmpPlane.position.y = -2.3
  const labelRmpTex = new DynamicTexture(
    'labelRmpTex',
    { width: 512, height: 64 },
    scene,
    false,
  )
  const labelRmpCtx = getCanvasCtx(labelRmpTex)
  labelRmpCtx.fillStyle = '#1a1a2e'
  labelRmpCtx.fillRect(0, 0, 512, 64)
  labelRmpCtx.fillStyle = '#0f9b8e'
  labelRmpCtx.font = 'bold 32px monospace'
  labelRmpCtx.textAlign = 'center'
  labelRmpCtx.textBaseline = 'middle'
  labelRmpCtx.fillText('REMAPPED PALETTE', 256, 32)
  labelRmpTex.update(true)
  const labelRmpMat = createTextureMaterial('labelRmpMat', labelRmpTex, scene)
  labelRmpPlane.material = labelRmpMat

  console.log(`[init] Scene: ${scene.meshes.length} meshes, ${scene.materials.length} materials`)

  // ---- 状态 ----
  let currentPalette: ImmutablePalette = createGradientPalette()
  let remappedPalette: ImmutablePalette = currentPalette
  let remapActive = false
  let showIndices = true
  let showGrid = true

  // ---- UI 元素绑定 ----
  const paletteSelect = document.getElementById('palette-select') as HTMLSelectElement
  const playerColorInput = document.getElementById('player-color') as HTMLInputElement
  const remapStartSlider = document.getElementById('remap-range-start') as HTMLInputElement
  const remapEndSlider = document.getElementById('remap-range-end') as HTMLInputElement
  const remapRangeLabel = document.getElementById('remap-range-label')!
  const valueMultSlider = document.getElementById('value-mult') as HTMLInputElement
  const vmValSpan = document.getElementById('vm-val')!
  const applyRemapBtn = document.getElementById('apply-remap') as HTMLButtonElement
  const resetRemapBtn = document.getElementById('reset-remap') as HTMLButtonElement
  const zoomSlider = document.getElementById('zoom-slider') as HTMLInputElement
  const zoomValSpan = document.getElementById('zoom-val')!
  const showIndicesCb = document.getElementById('show-indices') as HTMLInputElement
  const showGridCb = document.getElementById('show-grid') as HTMLInputElement

  const refSwatchesDiv = document.getElementById('reference-swatches')!

  /**
   * 更新参考色样本显示。
   */
  function updateReferenceSwatches(): void {
    const refIndices = [0, 1, 2, 3, 4, 10, 11, 12, 20, 176, 177, 180, 185, 191, 255]
    refSwatchesDiv.innerHTML = ''
    for (const idx of refIndices) {
      const { r, g, b } = fromArgb(currentPalette.at(idx))
      const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
      const span = document.createElement('span')
      span.style.cssText = `
        display:inline-flex;align-items:center;gap:3px;
        background:#0d1117;padding:2px 5px;border-radius:3px;
        font-family:monospace;font-size:10px;margin:1px;
      `
      span.innerHTML = `<span class="ref-color-swatch" style="background:${hex};"></span>${idx}:${hex}`
      refSwatchesDiv.appendChild(span)
    }
  }

  function getRemapRange(): number[] {
    const start = parseInt(remapStartSlider.value, 10)
    const end = parseInt(remapEndSlider.value, 10)
    const lo = Math.min(start, end)
    const hi = Math.max(start, end)
    const indices: number[] = []
    for (let i = lo; i <= hi; i++) {
      indices.push(i)
    }
    return indices
  }

  function applyRemap(): void {
    const hex = playerColorInput.value.replace('#', '')
    const playerColor = {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 255,
    }

    const remapIndices = getRemapRange()
    const valueMult = parseFloat(valueMultSlider.value)

    const adjustedColor = {
      r: playerColor.r,
      g: playerColor.g,
      b: playerColor.b,
      a: 255,
    }

    const baseRemap = new PlayerColorRemap(remapIndices, adjustedColor)
    const scalingRemap = {
      getRemappedColor(original: { r: number; g: number; b: number; a: number }, index: number): { r: number; g: number; b: number; a: number } {
        const result = baseRemap.getRemappedColor(original, index)
        if (!remapIndices.includes(index)) return result
        const scaled = {
          r: Math.min(255, Math.round(result.r * valueMult)),
          g: Math.min(255, Math.round(result.g * valueMult)),
          b: Math.min(255, Math.round(result.b * valueMult)),
          a: result.a,
        }
        return scaled
      },
    }

    remappedPalette = ImmutablePalette.fromRemapped(currentPalette, scalingRemap)
    remapActive = true
    applyRemapBtn.classList.add('active')
    updateTexture(texRemapped, remappedPalette, showIndices, showGrid, false)
  }

  function resetRemap(): void {
    remappedPalette = currentPalette
    remapActive = false
    applyRemapBtn.classList.remove('active')
    updateTexture(texRemapped, remappedPalette, showIndices, showGrid, false)
  }

  function refreshTextures(): void {
    updateTexture(texOriginal, currentPalette, showIndices, showGrid, true)
    if (remapActive) {
      applyRemap()
    } else {
      updateTexture(texRemapped, remappedPalette, showIndices, showGrid, false)
    }
    updateReferenceSwatches()
    infoPalRows.textContent = '1'
  }

  // 调色板切换
  paletteSelect.addEventListener('change', () => {
    switch (paletteSelect.value) {
      case 'gradient':
        currentPalette = createGradientPalette()
        break
      case 'reference':
        currentPalette = createReferencePalette()
        break
      case 'cctd':
        currentPalette = createCCTDPalette()
        break
    }
    remappedPalette = currentPalette
    remapActive = false
    applyRemapBtn.classList.remove('active')
    refreshTextures()
  })

  // 重映射范围滑块联动
  const updateRangeLabel = (): void => {
    const start = parseInt(remapStartSlider.value, 10)
    const end = parseInt(remapEndSlider.value, 10)
    remapRangeLabel.textContent = `${Math.min(start, end)}-${Math.max(start, end)}`
  }
  remapStartSlider.addEventListener('input', updateRangeLabel)
  remapEndSlider.addEventListener('input', updateRangeLabel)

  // 亮度缩放
  valueMultSlider.addEventListener('input', () => {
    vmValSpan.textContent = parseFloat(valueMultSlider.value).toFixed(2)
  })

  // 应用/重置按钮
  applyRemapBtn.addEventListener('click', applyRemap)
  resetRemapBtn.addEventListener('click', resetRemap)

  // 缩放
  zoomSlider.addEventListener('input', () => {
    const z = parseFloat(zoomSlider.value)
    zoomValSpan.textContent = `${z.toFixed(1)}x`
    camera.orthoTop = 5 / z
    camera.orthoBottom = -5 / z
    camera.orthoLeft = -5 / z
    camera.orthoRight = 5 / z
  })

  // 显示选项
  showIndicesCb.addEventListener('change', () => {
    showIndices = showIndicesCb.checked
    refreshTextures()
  })
  showGridCb.addEventListener('change', () => {
    showGrid = showGridCb.checked
    refreshTextures()
  })

  // ---- 初始化 ----
  const initZoom = parseFloat(zoomSlider.value)
  camera.orthoTop = 5 / initZoom
  camera.orthoBottom = -5 / initZoom
  camera.orthoLeft = -5.5 / initZoom
  camera.orthoRight = 5.5 / initZoom

  refreshTextures()

  // ---- FPS 监控 + 渲染循环 ----
  let fpsFrames = 0
  let fpsAccum = 0
  let fpsDisplay = 0
  let lastFpsUpdate = performance.now()
  let firstFrame = true

  scene.onBeforeRenderObservable.add(() => {
    const now = performance.now()
    fpsFrames++
    fpsAccum += now - lastFpsUpdate
    lastFpsUpdate = now

    if (fpsAccum >= 500) {
      fpsDisplay = Math.round((fpsFrames / fpsAccum) * 1000)
      fpsFrames = 0
      fpsAccum = 0
    }

    if (firstFrame) {
      firstFrame = false
      console.log(`[render-loop] first frame: fps=${fpsDisplay} meshes=${scene.meshes.length} camera=${scene.activeCamera?.name || 'none'}`)
    }

    infoFps.textContent = String(fpsDisplay)
    infoFrameTime.textContent = fpsDisplay > 0
      ? `${(1000 / fpsDisplay).toFixed(1)}ms`
      : '-'
    infoTime.textContent = new Date().toISOString()
  })

  engine.runRenderLoop(() => {
    scene.render()
  })

  // ---- Canvas 自适应 ----
  const resizeObserver = new ResizeObserver(() => {
    engine.resize()
  })
  resizeObserver.observe(canvas)
}

main().catch((err: unknown) => {
  console.error('[fatal] main() failed:', err)
  const errorEl = document.getElementById('gpu-error')!
  errorEl.style.display = 'flex'
  errorEl.textContent = `初始化失败: ${err instanceof Error ? err.message : String(err)}`
})
