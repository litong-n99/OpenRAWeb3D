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
  // 默认填充深灰色
  for (let i = 0; i < PALETTE_SIZE; i++) {
    colors[i] = toArgb(255, 26, 26, 26)
  }

  // 在特定索引放置已知参考色
  const refs: [number, number, number, number, number][] = [
    // [index, A, R, G, B]
    [0,   255, 0,   0,   0],    // 纯黑
    [1,   255, 255, 0,   0],    // 纯红
    [2,   255, 0,   255, 0],    // 纯绿
    [3,   255, 0,   0,   255],  // 纯蓝
    [4,   255, 255, 255, 255],  // 纯白
    [10,  255, 255, 255, 0],    // 黄
    [11,  255, 0,   255, 255],  // 青
    [12,  255, 255, 0,   255],  // 品红
    [20,  255, 128, 128, 128],  // 中灰
    [21,  255, 64,  64,  64],   // 深灰
    [22,  255, 192, 192, 192],  // 浅灰
    [30,  255, 128, 0,   0],    // 暗红
    [31,  255, 0,   128, 0],    // 暗绿
    [32,  255, 0,   0,   128],  // 暗蓝
    [40,  255, 255, 128, 0],    // 橙
    [41,  255, 128, 0,   255],  // 紫
    [50,  128, 255, 0,   0],    // 半透明红
    [51,  128, 0,   255, 0],    // 半透明绿
    [52,  128, 0,   0,   255],  // 半透明蓝
    [60,  0,   0,   0,   0],    // 完全透明
    [176, 255, 180, 180, 210],  // 玩家色槽 1 (浅蓝灰)
    [177, 255, 160, 160, 200],  // 玩家色槽 2
    [178, 255, 140, 140, 180],  // 玩家色槽 3
    [179, 255, 120, 120, 170],  // 玩家色槽 4
    [180, 255, 100, 100, 160],  // 玩家色槽 5
    [181, 255, 90,  90,  150],  // 玩家色槽 6
    [182, 255, 80,  80,  140],  // 玩家色槽 7
    [183, 255, 70,  70,  130],  // 玩家色槽 8
    [184, 255, 200, 180, 160],  // 玩家色槽 9 (暖灰)
    [185, 255, 190, 170, 150],  // 玩家色槽 10
    [186, 255, 180, 160, 140],  // 玩家色槽 11
    [187, 255, 170, 150, 130],  // 玩家色槽 12
    [188, 255, 160, 140, 120],  // 玩家色槽 13
    [189, 255, 150, 130, 110],  // 玩家色槽 14
    [190, 255, 140, 120, 100],  // 玩家色槽 15
    [191, 255, 130, 110, 90],   // 玩家色槽 16
    [200, 255, 255, 0,   128],  // 亮粉
    [210, 255, 0,   128, 128],  // 蓝绿
    [220, 255, 128, 128, 0],    // 橄榄
    [240, 255, 0,   255, 128],  // 春绿
    [250, 255, 255, 128, 128],  // 浅粉
  ]

  for (const [idx, a, r, g, b] of refs) {
    colors[idx] = toArgb(a, r, g, b)
  }

  return ImmutablePalette.fromColors(colors)
}

/**
 * 创建模拟 C&C Tiberian Dawn 风格的调色板。
 *
 * 包含大地色系、金属色、玩家色槽位（176-191）、火焰/高亮色。
 */
function createCCTDPalette(): ImmutablePalette {
  const colors = new Uint32Array(PALETTE_SIZE)

  // 0-15: 暗色/黑色系
  for (let i = 0; i < 16; i++) {
    const v = Math.round((i / 15) * 40)
    colors[i] = toArgb(255, v, v, v)
  }
  // 16-31: 大地棕色系
  for (let i = 0; i < 16; i++) {
    const t = i / 15
    colors[16 + i] = toArgb(255,
      Math.round(80 + t * 80),
      Math.round(50 + t * 60),
      Math.round(20 + t * 30),
    )
  }
  // 32-63: 植被绿色系
  for (let i = 0; i < 32; i++) {
    const t = i / 31
    colors[32 + i] = toArgb(255,
      Math.round(20 + t * 30),
      Math.round(60 + t * 120),
      Math.round(10 + t * 40),
    )
  }
  // 64-95: 水面蓝色系
  for (let i = 0; i < 32; i++) {
    const t = i / 31
    colors[64 + i] = toArgb(255,
      Math.round(10 + t * 20),
      Math.round(30 + t * 60),
      Math.round(80 + t * 150),
    )
  }
  // 96-127: 金属灰色系
  for (let i = 0; i < 32; i++) {
    const t = i / 31
    const v = Math.round(60 + t * 160)
    colors[96 + i] = toArgb(255, v, v, v)
  }
  // 128-159: 暖色/沙漠系
  for (let i = 0; i < 32; i++) {
    const t = i / 31
    colors[128 + i] = toArgb(255,
      Math.round(180 + t * 75),
      Math.round(140 + t * 80),
      Math.round(80 + t * 60),
    )
  }
  // 160-175: 火焰/高亮色系
  for (let i = 0; i < 16; i++) {
    const t = i / 15
    colors[160 + i] = toArgb(255,
      255,
      Math.round(200 - t * 150),
      Math.round(50 - t * 40),
    )
  }
  // 176-191: 玩家颜色槽位（蓝灰色系 — 将被 PlayerColorRemap 替换）
  for (let i = 0; i < 16; i++) {
    const t = i / 15
    colors[176 + i] = toArgb(255,
      Math.round(200 - t * 80),
      Math.round(200 - t * 80),
      Math.round(220 - t * 80),
    )
  }
  // 192-223: 紫色/特殊色系
  for (let i = 0; i < 32; i++) {
    const t = i / 31
    colors[192 + i] = toArgb(255,
      Math.round(80 + t * 120),
      Math.round(10 + t * 40),
      Math.round(80 + t * 120),
    )
  }
  // 224-254: 亮色高光系
  for (let i = 0; i < 31; i++) {
    const t = i / 30
    colors[224 + i] = toArgb(255,
      Math.round(200 + t * 55),
      Math.round(180 + t * 75),
      Math.round(100 + t * 155),
    )
  }
  // 255: 纯白
  colors[255] = toArgb(255, 255, 255, 255)

  return ImmutablePalette.fromColors(colors)
}

// ---------------------------------------------------------------------------
// 纹理绘制
// ---------------------------------------------------------------------------

/**
 * 将调色板绘制到 DynamicTexture 的 2D canvas 上，呈现为 16x16 色块网格。
 *
 * @param ctx — Canvas 2D 渲染上下文
 * @param palette — 要绘制的调色板（256 色）
 * @param showIndices — 是否在每个色块上叠加索引号文本
 * @param showGrid — 是否绘制网格线
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

    // 透明像素显示棋盘格背景
    if (a < 255) {
      ctx.fillStyle = '#333'
      ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE)
      const half = CELL_SIZE / 2
      ctx.fillStyle = '#555'
      ctx.fillRect(x, y, half, half)
      ctx.fillRect(x + half, y + half, half, half)
    }

    // 绘制颜色块（预乘 Alpha 由 CSS rgba 处理）
    ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`
    ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE)

    // 网格线
    if (showGrid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.lineWidth = 0.5
      ctx.strokeRect(x + 0.25, y + 0.25, CELL_SIZE - 0.5, CELL_SIZE - 0.5)
    }

    // 索引号
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
 *
 * Babylon.js 的 getContext() 返回 ICanvasRenderingContext（子集类型），
 * 此处通过类型断言转换为完整的 CanvasRenderingContext2D。
 */
function getCanvasCtx(texture: DynamicTexture): CanvasRenderingContext2D {
  return texture.getContext() as unknown as CanvasRenderingContext2D
}

/**
 * 更新 DynamicTexture 的内容。
 */
function updateTexture(
  texture: DynamicTexture,
  palette: IPalette,
  showIndices: boolean,
  showGrid: boolean,
): void {
  const ctx = getCanvasCtx(texture)
  drawPaletteToCanvas(ctx, palette, showIndices, showGrid)
  texture.update(false)
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
  const canvas = document.createElement('canvas')
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  document.getElementById('sandbox')!.appendChild(canvas)

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
  infoEngine.textContent = `Babylon.js v${Engine.Version} / WebGL ${webGlVersion}.0`

  const scene = new Scene(engine)
  scene.clearColor.set(0.1, 0.11, 0.14, 1)

  // 正交相机：从 +Z 轴正对调色板纹理平面（平面默认朝向 +Z）
  const camera = new ArcRotateCamera(
    'cam',
    0,                 // alpha: 相机在 +Z 轴上
    Math.PI / 2,       // beta: 水平视角
    8,                 // radius
    new Vector3(0, 0, 0),
    scene,
  )
  camera.mode = 1 // ORTHOGRAPHIC_CAMERA
  camera.lowerRadiusLimit = 3
  camera.upperRadiusLimit = 30
  camera.panningSensibility = 200
  // 禁用自动旋转，允许鼠标拖拽平移
  camera.inputs.clear()
  // 保留简单的鼠标滚轮缩放（通过 radius）
  camera.inputs.addMouseWheel()

  // 光照（StandardMaterial 需要）
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
  const matOriginal = new StandardMaterial('matOriginal', scene)
  matOriginal.diffuseTexture = texOriginal
  matOriginal.specularColor.set(0, 0, 0)
  matOriginal.backFaceCulling = false

  const planeOriginal = MeshBuilder.CreatePlane(
    'planeOriginal',
    { width: 4, height: 4 },
    scene,
  )
  planeOriginal.position.x = -2.2
  planeOriginal.position.y = 0
  planeOriginal.material = matOriginal

  // 标签 "ORIGINAL" 在平面下方（使用第二个更小的平面做标签，简化实现）
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
  labelOrigTex.update(false)
  const labelOrigMat = new StandardMaterial('labelOrigMat', scene)
  labelOrigMat.diffuseTexture = labelOrigTex
  labelOrigMat.specularColor.set(0, 0, 0)
  labelOrigMat.backFaceCulling = false
  labelOrigPlane.material = labelOrigMat

  // 右侧：重映射后调色板
  const texRemapped = new DynamicTexture(
    'texRemapped',
    { width: TEX_WIDTH, height: TEX_HEIGHT },
    scene,
    false,
  )
  const matRemapped = new StandardMaterial('matRemapped', scene)
  matRemapped.diffuseTexture = texRemapped
  matRemapped.specularColor.set(0, 0, 0)
  matRemapped.backFaceCulling = false

  const planeRemapped = MeshBuilder.CreatePlane(
    'planeRemapped',
    { width: 4, height: 4 },
    scene,
  )
  planeRemapped.position.x = 2.2
  planeRemapped.position.y = 0
  planeRemapped.material = matRemapped

  // 标签 "REMAPPED"
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
  labelRmpTex.update(false)
  const labelRmpMat = new StandardMaterial('labelRmpMat', scene)
  labelRmpMat.diffuseTexture = labelRmpTex
  labelRmpMat.specularColor.set(0, 0, 0)
  labelRmpMat.backFaceCulling = false
  labelRmpPlane.material = labelRmpMat

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

  // 参考色样本容器
  const refSwatchesDiv = document.getElementById('reference-swatches')!

  /**
   * 更新参考色样本显示（左下角控件面板）。
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

  /**
   * 获取当前重映射索引范围。
   */
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

  /**
   * 应用 PlayerColorRemap 并更新右侧纹理。
   */
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

    // PlayerColorRemap 使用原始的 _value，但 valueMultiplier 由调用方处理
    // 这里我们通过重新创建 remap 来应用 valueMultiplier
    const adjustedColor = {
      r: playerColor.r,
      g: playerColor.g,
      b: playerColor.b,
      a: 255,
    }

    // 亮度缩放：在构建 remap 时无法直接传入 valueMultiplier，
    // 因此通过 ScalingRemap 适配器封装原始 remap
    const baseRemap = new PlayerColorRemap(remapIndices, adjustedColor)
    const scalingRemap = {
      getRemappedColor(original: { r: number; g: number; b: number; a: number }, index: number): { r: number; g: number; b: number; a: number } {
        const result = baseRemap.getRemappedColor(original, index)
        if (!remapIndices.includes(index)) return result
        // 应用亮度缩放
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
    updateTexture(texRemapped, remappedPalette, showIndices, showGrid)
  }

  /**
   * 重置重映射（右侧显示原始调色板）。
   */
  function resetRemap(): void {
    remappedPalette = currentPalette
    remapActive = false
    applyRemapBtn.classList.remove('active')
    updateTexture(texRemapped, remappedPalette, showIndices, showGrid)
  }

  /**
   * 刷新两个纹理（当调色板切换或显示选项改变时调用）。
   */
  function refreshTextures(): void {
    updateTexture(texOriginal, currentPalette, showIndices, showGrid)
    if (remapActive) {
      applyRemap()
    } else {
      updateTexture(texRemapped, remappedPalette, showIndices, showGrid)
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

  // ---- FPS 监控 ----
  let fpsFrames = 0
  let fpsAccum = 0
  let fpsDisplay = 0
  let lastFpsUpdate = performance.now()

  scene.onBeforeRenderObservable.add(() => {
    const now = performance.now()
    fpsFrames++
    fpsAccum += now - lastFpsUpdate
    lastFpsUpdate = now

    // 每 500ms 更新一次 FPS 显示
    if (fpsAccum >= 500) {
      fpsDisplay = Math.round((fpsFrames / fpsAccum) * 1000)
      fpsFrames = 0
      fpsAccum = 0
    }

    infoFps.textContent = String(fpsDisplay)
    infoFrameTime.textContent = fpsDisplay > 0
      ? `${(1000 / fpsDisplay).toFixed(1)}ms`
      : '-'
    infoTime.textContent = new Date().toISOString()
  })

  // ---- 渲染循环 ----
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
  const errorEl = document.getElementById('gpu-error')!
  errorEl.style.display = 'flex'
  errorEl.textContent = `初始化失败: ${err instanceof Error ? err.message : String(err)}`
  console.error(err)
})
