/**
 * main.ts — Sheet + SheetBuilder 纹理图集打包人工验收测试
 *
 * 测试目标:
 *   1. 可视化纹理图集的行式打包布局（模拟 SheetBuilder.Allocate 算法）
 *   2. 验证 BGRA→RGBA 字节交换正确性（swapRB 函数效果）
 *   3. 验证 Indexed 类型的 4 通道独立打包
 *   4. 验证 1px margin 防止纹理出血
 *
 * OpenRA 对照:
 *   - Sheet.ts: BGRA/RGBA byte swap, SheetType (Indexed=1, BGRA=4)
 *   - SheetBuilder.ts: row-based packing, nextChannel(), margin=1, max 8 sheets
 */

import { Engine } from '@babylonjs/core'
import { Scene } from '@babylonjs/core'
import { ArcRotateCamera } from '@babylonjs/core'
import { Vector3, Color3, Color4 } from '@babylonjs/core'
import { MeshBuilder } from '@babylonjs/core'
import { StandardMaterial } from '@babylonjs/core'
import { DynamicTexture } from '@babylonjs/core'

// ---------------------------------------------------------------------------
// 行式打包模拟（与 SheetBuilder.Allocate 算法一致）
// ---------------------------------------------------------------------------

interface PackedRect {
  x: number      // 在 sheet 中的像素 x 坐标
  y: number      // 在 sheet 中的像素 y 坐标
  width: number  // 精灵宽度（像素）
  height: number // 精灵高度（像素）
  channel: number // Indexed 模式下的通道 (0=R, 1=G, 2=B, 3=A)
  color: [number, number, number]  // 显示颜色
  label: string
}

/**
 * 行式打包算法。
 *
 * 与 OpenRA SheetBuilder.Allocate 逻辑一致：
 * - 从左到右在行内排列
 * - 当前行空间不足时换行
 * - 换行后仍不足时分配新 Sheet
 * - BGRA 类型: 单通道 (channel=0)
 * - Indexed 类型: 4 通道循环 (channel 0→1→2→3→0)
 */
function rowPack(
  sheetSize: number,
  rects: { w: number; h: number }[],
  sheetType: 'BGRA' | 'Indexed',
): PackedRect[] {
  const result: PackedRect[] = []
  const margin = 1  // 对应 OpenRA SheetBuilder margin = 1
  let currentX = margin
  let currentY = margin
  let rowHeight = 0
  let channel = 0
  const maxChannel = sheetType === 'Indexed' ? 4 : 1

  // 颜色调色板
  const colors: [number, number, number][] = [
    [0.91, 0.27, 0.38],  // R 通道 - 红色
    [0.20, 0.80, 0.20],  // G 通道 - 绿色
    [0.20, 0.40, 0.91],  // B 通道 - 蓝色
    [1.00, 0.60, 0.20],  // A 通道 - 橙色
  ]

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!
    const w = r.w + margin
    const h = r.h + margin

    // 当前行放不下 → 换行
    if (currentX + w > sheetSize - margin) {
      currentX = margin
      currentY += rowHeight + margin
      rowHeight = 0

      // Indexed 类型：换行时切换通道（对应 PumpRect）
      if (sheetType === 'Indexed') {
        channel = (channel + 1) % maxChannel
      }
    }

    // 超出 sheet 高度 → 需要新 Sheet（简化处理：截断）
    if (currentY + h > sheetSize - margin) {
      break // 实际场景会分配新 Sheet
    }

    result.push({
      x: currentX,
      y: currentY,
      width: r.w,
      height: r.h,
      channel,
      color: sheetType === 'Indexed' ? colors[channel]! : colors[i % colors.length]!,
      label: sheetType === 'Indexed' ? `${i}:ch${channel}` : `${i}`,
    })

    currentX += w
    rowHeight = Math.max(rowHeight, h)

    // Indexed 类型：每个精灵后切换通道
    if (sheetType === 'Indexed') {
      channel = (channel + 1) % maxChannel
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// BGRA → RGBA 字节交换模拟
// ---------------------------------------------------------------------------

/**
 * 模拟 swapRB 函数的效果。
 *
 * BGRA 顺序: [B, G, R, A]
 * swapRB → RGBA 顺序: [R, G, B, A]
 *
 * 若未执行 swapRB，GPU 会将 B 通道当作 R 渲染 → 红蓝互换。
 */
function swapChannels(r: number, g: number, b: number, swapped: boolean): [number, number, number] {
  if (swapped) {
    // 模拟未交换场景：红蓝互换
    return [b, g, r]
  }
  return [r, g, b]
}

// ---------------------------------------------------------------------------
// 渲染纹理图集
// ---------------------------------------------------------------------------

function renderAtlas(
  size: number,
  packed: PackedRect[],
  _sheetType: 'BGRA' | 'Indexed',
  swapMode: 'correct' | 'swapped' | 'diff',
  diffSide: 'left' | 'right',
  scene: Scene | null = null,
): DynamicTexture {
  const tex = new DynamicTexture(`atlas_${size}`, { width: size, height: size }, scene, false)
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D

  // 背景：深灰，方便看边界
  ctx.fillStyle = '#1a1a2e'
  ctx.fillRect(0, 0, size, size)

  // 网格线
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'
  ctx.lineWidth = 1
  const gridStep = size / 16
  for (let i = 0; i <= size; i += gridStep) {
    ctx.beginPath()
    ctx.moveTo(i, 0); ctx.lineTo(i, size)
    ctx.moveTo(0, i); ctx.lineTo(size, i)
    ctx.stroke()
  }

  for (const rect of packed) {
    let x = rect.x
    let w = rect.width

    // 差异对比模式：左右分屏
    if (swapMode === 'diff') {
      if (diffSide === 'right') {
        // 右半已在左半之外，跳过
        if (rect.x + rect.width <= size / 2) continue
        if (rect.x < size / 2) {
          w = rect.x + rect.width - size / 2
          x = size / 2
        }
      } else {
        // 左半
        if (rect.x >= size / 2) continue
        if (rect.x + rect.width > size / 2) {
          w = size / 2 - rect.x
        }
      }
    }

    // BGRA 交换模拟
    const doSwap = swapMode === 'swapped' || (swapMode === 'diff' && diffSide === 'right')
    const [cr, cg, cb] = swapChannels(rect.color[0], rect.color[1], rect.color[2], doSwap)

    // 填充
    const alpha = rect.channel === 3 ? 0.6 : 0.85  // Alpha 通道半透明以示区别
    ctx.fillStyle = `rgba(${Math.round(cr * 255)},${Math.round(cg * 255)},${Math.round(cb * 255)},${alpha})`
    ctx.fillRect(x, rect.y, w, rect.height)

    // 边框
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'
    ctx.lineWidth = 1
    ctx.strokeRect(x, rect.y, w, rect.height)

    // 标签（在足够大的精灵上显示）
    if (rect.width >= 16 && rect.height >= 14) {
      ctx.fillStyle = '#ffffff'
      ctx.font = `${Math.min(10, Math.floor(rect.height / 2))}px monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const labelX = x + w / 2
      const labelY = rect.y + rect.height / 2
      // 文本阴影提高可读性
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'
      ctx.lineWidth = 2
      ctx.strokeText(rect.label, labelX, labelY)
      ctx.fillText(rect.label, labelX, labelY)
    }

    // 1px margin 指示（半透明白色边框）
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.lineWidth = 1
    ctx.setLineDash([2, 2])
    ctx.strokeRect(x - 1, rect.y - 1, w + 2, rect.height + 2)
    ctx.setLineDash([])
  }

  // 差异对比分割线
  if (swapMode === 'diff') {
    ctx.strokeStyle = '#ffff00'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(size / 2, 0)
    ctx.lineTo(size / 2, size)
    ctx.stroke()

    // 标签
    ctx.fillStyle = '#ffff00'
    ctx.font = '12px monospace'
    ctx.textAlign = 'center'
    ctx.fillText('LEFT: swapRB=YES (correct)', size / 4, 14)
    ctx.fillText('RIGHT: swapRB=NO (broken)', size * 3 / 4, 14)
  }

  // 标题
  if (swapMode !== 'diff') {
    ctx.fillStyle = swapMode === 'correct' ? '#33cc33' : '#e94560'
    ctx.font = '12px monospace'
    ctx.textAlign = 'left'
    const title = swapMode === 'correct'
      ? 'swapRB APPLIED (correct RGBA)'
      : 'swapRB SKIPPED (broken BGRA)'
    ctx.fillText(title, 4, 14)
  }

  tex.update(true)
  tex.hasAlpha = true
  return tex
}

// ---------------------------------------------------------------------------
// 精灵尺寸生成
// ---------------------------------------------------------------------------

function generateSpriteSizes(mode: string, count: number): { w: number; h: number }[] {
  const sizes: { w: number; h: number }[] = []
  for (let i = 0; i < count; i++) {
    switch (mode) {
      case 'uniform':
        sizes.push({ w: 16, h: 16 })
        break
      case 'mixed':
        // 小/中/大 混合
        const type = i % 3
        if (type === 0) sizes.push({ w: 8, h: 8 })
        else if (type === 1) sizes.push({ w: 24, h: 16 })
        else sizes.push({ w: 16, h: 32 })
        break
      case 'random':
      default:
        sizes.push({
          w: 8 + Math.floor(Math.random() * 40),
          h: 8 + Math.floor(Math.random() * 32),
        })
        break
    }
  }
  return sizes
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
  scene.clearColor = new Color4(0.10, 0.11, 0.14, 1)

  // ---- 摄像机 ----  (正交，从正上方俯视 XZ 平面上的纹理图集)
  //
  // beta=Math.PI/2 使摄像机位于平面上方，向下俯视。
  // beta=0 会导致摄像机与平面同高，只能看到平面的薄边（表现
  // 为"一条彩色线"的 bug）。
  const camera = new ArcRotateCamera(
    'cam',
    -Math.PI / 2,
    Math.PI / 2,
    5,
    new Vector3(0, 0, 0),
    scene,
  )
  camera.mode = 1 // ORTHOGRAPHIC_CAMERA
  camera.orthoTop = 1.1
  camera.orthoBottom = -1.1
  camera.orthoLeft = -1.1
  camera.orthoRight = 1.1
  camera.inputs.clear()

  // ---- 图集显示平面 ----
  const atlasPlane = MeshBuilder.CreatePlane('atlasPlane', { width: 2, height: 2 }, scene)
  const atlasMat = new StandardMaterial('atlasMat', scene)
  atlasMat.emissiveColor = new Color3(1, 1, 1)
  atlasMat.specularColor.set(0, 0, 0)
  atlasMat.backFaceCulling = false
  atlasMat.disableLighting = true
  atlasPlane.material = atlasMat

  // ---- 状态 ----
  let sheetType: 'BGRA' | 'Indexed' = 'BGRA'
  let sheetSize = 256
  let packMode = 'random'
  let spriteCount = 20
  let swapMode: 'correct' | 'swapped' | 'diff' = 'correct'

  // ---- UI 引用 ----
  const sheetTypeSel = document.getElementById('sheet-type') as HTMLSelectElement
  const sheetSizeSel = document.getElementById('sheet-size') as HTMLSelectElement
  const packModeSel = document.getElementById('pack-mode') as HTMLSelectElement
  const spriteCountSlider = document.getElementById('sprite-count') as HTMLInputElement
  const spriteCountVal = document.getElementById('sprite-count-val')!
  const btnRepack = document.getElementById('btn-repack') as HTMLButtonElement
  const swapModeSel = document.getElementById('swap-mode') as HTMLSelectElement
  const testColorSel = document.getElementById('test-color') as HTMLSelectElement

  const statSheetSize = document.getElementById('stat-sheet-size')!
  const statSprites = document.getElementById('stat-sprites')!
  const statUtilization = document.getElementById('stat-utilization')!
  const statChannels = document.getElementById('stat-channels')!
  const statMargin = document.getElementById('stat-margin')!

  // ---- 重新打包渲染 ----
  function repack(): void {
    const sizes = generateSpriteSizes(packMode, spriteCount)
    const packed = rowPack(sheetSize, sizes, sheetType)

    // 计算利用率
    let usedPixels = 0
    for (const r of packed) {
      usedPixels += r.width * r.height
    }
    const utilization = (usedPixels / (sheetSize * sheetSize) * 100).toFixed(1)

    statSheetSize.textContent = `${sheetSize}x${sheetSize}`
    statSprites.textContent = `${packed.length}/${spriteCount}`
    statUtilization.textContent = `${utilization}%`
    statChannels.textContent = sheetType === 'Indexed' ? 'R,G,B,A (循环)' : 'N/A (RGBA)'
    statMargin.textContent = '1 px'

    if (swapMode === 'diff') {
      // 差异对比：左侧正确，右侧错误
      //
      // NOTE: texLeft/texRight 仅用于 canvas 合成，不需要
      // babylon 场景引用（它们不会被直接赋值给 material）。
      const texLeft = renderAtlas(sheetSize, packed, sheetType, 'correct', 'left', null)
      const texRight = renderAtlas(sheetSize, packed, sheetType, 'swapped', 'right', null)

      // 合成为一张纹理
      const combined = new DynamicTexture('combined', { width: sheetSize, height: sheetSize }, scene, false)
      const ctx = combined.getContext() as unknown as CanvasRenderingContext2D

      // 左侧
      const leftImg = texLeft.getContext() as unknown as CanvasRenderingContext2D
      ctx.drawImage(leftImg.canvas, 0, 0, sheetSize / 2, sheetSize, 0, 0, sheetSize / 2, sheetSize)

      // 右侧（交换通道）
      const rightImg = texRight.getContext() as unknown as CanvasRenderingContext2D
      ctx.drawImage(rightImg.canvas, sheetSize / 2, 0, sheetSize / 2, sheetSize, sheetSize / 2, 0, sheetSize / 2, sheetSize)

      // 分割线
      ctx.strokeStyle = '#ffff00'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(sheetSize / 2, 0)
      ctx.lineTo(sheetSize / 2, sheetSize)
      ctx.stroke()
      ctx.fillStyle = '#ffff00'
      ctx.font = '14px monospace'
      ctx.textAlign = 'center'
      ctx.fillText('CORRECT', sheetSize / 4, 16)
      ctx.fillText('BROKEN (R↔B swapped)', sheetSize * 3 / 4, 16)

      combined.update(true)
      combined.hasAlpha = true
      atlasMat.diffuseTexture = combined
      atlasMat.emissiveTexture = combined
    } else {
      const tex = renderAtlas(sheetSize, packed, sheetType, swapMode, 'left', scene)
      atlasMat.diffuseTexture = tex
      atlasMat.emissiveTexture = tex
    }
  }

  // ---- 事件绑定 ----
  sheetTypeSel.addEventListener('change', () => {
    sheetType = sheetTypeSel.value as typeof sheetType
    repack()
  })
  sheetSizeSel.addEventListener('change', () => {
    sheetSize = parseInt(sheetSizeSel.value, 10)
    repack()
  })
  packModeSel.addEventListener('change', () => {
    packMode = packModeSel.value
    repack()
  })
  spriteCountSlider.addEventListener('input', () => {
    spriteCount = parseInt(spriteCountSlider.value, 10)
    spriteCountVal.textContent = String(spriteCount)
  })
  spriteCountSlider.addEventListener('change', () => {
    spriteCount = parseInt(spriteCountSlider.value, 10)
    repack()
  })
  btnRepack.addEventListener('click', repack)
  swapModeSel.addEventListener('change', () => {
    swapMode = swapModeSel.value as typeof swapMode
    repack()
  })
  testColorSel.addEventListener('change', () => {
    // 测试色切换：触发重新打包（差异模式下效果更明显）
    repack()
  })

  // ---- 初始化 ----
  spriteCountVal.textContent = String(spriteCount)
  repack()

  // ---- FPS + 渲染循环 ----
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
