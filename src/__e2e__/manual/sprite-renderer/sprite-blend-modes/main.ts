/**
 * main.ts — SpriteRenderer 混合模式人工验收测试
 *
 * 测试目标:
 *   1. 验证 10 种 OpenRA BlendMode 到 Babylon.js alphaMode 的映射正确性
 *   2. 验证每种混合模式在叠加场景下的视觉效果
 *   3. 验证 blendModeToAlphaMode() 函数的所有分支
 *
 * OpenRA 对照: SpriteRenderer.ts blendModeToAlphaMode(), BlendMode 枚举
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
import {
  BlendMode,
  blendModeToAlphaMode,
} from '../../../../OpenRA.Game/Graphics/SpriteRenderer'

// ---------------------------------------------------------------------------
// 混合模式元数据
// ---------------------------------------------------------------------------

interface BlendInfo {
  mode: string
  label: string
  alphaMode: number
  alphaModeLabel: string
  description: string
  expectedBehavior: string
}

const BLEND_INFOS: BlendInfo[] = [
  {
    mode: BlendMode.None,
    label: 'None',
    alphaMode: blendModeToAlphaMode(BlendMode.None),
    alphaModeLabel: 'ALPHA_DISABLE',
    description: '无混合 — 完全不透明，忽略 Alpha 通道',
    expectedBehavior: '颜色圆圈应完全不透明，覆盖背景。无任何透明效果。',
  },
  {
    mode: BlendMode.Alpha,
    label: 'Alpha',
    alphaMode: blendModeToAlphaMode(BlendMode.Alpha),
    alphaModeLabel: 'ALPHA_COMBINE',
    description: '标准 Alpha 混合 — src*alpha + dst*(1-alpha)',
    expectedBehavior: '半透明圆圈叠加时，重叠区域颜色混合自然。白色圆圈叠加在红色上呈现粉红色过渡。',
  },
  {
    mode: BlendMode.Translucent,
    label: 'Translucent',
    alphaMode: blendModeToAlphaMode(BlendMode.Translucent),
    alphaModeLabel: 'ALPHA_COMBINE (same as Alpha)',
    description: '半透明 — 与 Alpha 模式共享相同映射',
    expectedBehavior: '与 Alpha 模式行为相同，都是标准 Alpha 混合。',
  },
  {
    mode: BlendMode.Additive,
    label: 'Additive',
    alphaMode: blendModeToAlphaMode(BlendMode.Additive),
    alphaModeLabel: 'ALPHA_ADD',
    description: '加法混合 — src*alpha + dst',
    expectedBehavior: '重叠区域明显**变亮**，白色圆圈叠加在红色上产生亮粉色。无深色区域。',
  },
  {
    mode: BlendMode.LowAdditive,
    label: 'LowAdditive',
    alphaMode: blendModeToAlphaMode(BlendMode.LowAdditive),
    alphaModeLabel: 'ALPHA_ADD (same as Additive)',
    description: '低强度加法 — 与 Additive 使用相同映射（低强度由 alpha 值控制）',
    expectedBehavior: '使用低 alpha 值时颜色增量较小。',
  },
  {
    mode: BlendMode.Subtractive,
    label: 'Subtractive',
    alphaMode: blendModeToAlphaMode(BlendMode.Subtractive),
    alphaModeLabel: 'ALPHA_SUBTRACT',
    description: '减法混合 — dst - src*alpha',
    expectedBehavior: '重叠区域明显**变暗**。白色圆圈叠加在红色上产生暗色/黑色区域。',
  },
  {
    mode: BlendMode.Multiply,
    label: 'Multiply',
    alphaMode: blendModeToAlphaMode(BlendMode.Multiply),
    alphaModeLabel: 'ALPHA_MULTIPLY',
    description: '乘法混合 — src*dst (颜色相乘)',
    expectedBehavior: '重叠区域变暗，保留底色色相。白色圆圈叠加在红色上呈现更暗的红色。',
  },
  {
    mode: BlendMode.Multiplicative,
    label: 'Multiplicative',
    alphaMode: blendModeToAlphaMode(BlendMode.Multiplicative),
    alphaModeLabel: 'ALPHA_MULTIPLY (same as Multiply)',
    description: '乘法混合 — 与 Multiply 共享相同映射',
    expectedBehavior: '与 Multiply 模式行为相同。',
  },
  {
    mode: BlendMode.DoubleMultiplicative,
    label: 'DoubleMultiplicative',
    alphaMode: blendModeToAlphaMode(BlendMode.DoubleMultiplicative),
    alphaModeLabel: 'ALPHA_MULTIPLY (same as Multiply)',
    description: '双倍乘法 — 与 Multiply 映射相同（双倍效果由着色器/alpha 值控制）',
    expectedBehavior: '叠加效果比 Multiply 更强（若 alpha=1 可能行为相同）。',
  },
  {
    mode: BlendMode.Screen,
    label: 'Screen',
    alphaMode: blendModeToAlphaMode(BlendMode.Screen),
    alphaModeLabel: 'ALPHA_SCREENMODE',
    description: '屏幕混合 — 1 - (1-src)*(1-dst)',
    expectedBehavior: '重叠区域变亮，但不会过曝。类似 Additive 但更柔和。',
  },
]

// ---------------------------------------------------------------------------
// 辅助：创建棋盘格纹理
// ---------------------------------------------------------------------------

function createCheckerboardTexture(scene: Scene): DynamicTexture {
  const size = 64
  const tex = new DynamicTexture('checker', { width: size * 2, height: size * 2 }, scene, false)
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#333333' : '#555555'
      ctx.fillRect(x * size, y * size, size, size)
    }
  }
  tex.update(true)
  tex.uScale = 8
  tex.vScale = 8
  return tex
}

// ---------------------------------------------------------------------------
// 辅助：创建标签纹理
// ---------------------------------------------------------------------------

function createLabelTexture(name: string, text: string, scene: Scene): DynamicTexture {
  const w = 1024, h = 64
  const tex = new DynamicTexture(name, { width: w, height: h }, scene, false)
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 40px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, w / 2, h / 2)
  tex.update(true)
  return tex
}

// ---------------------------------------------------------------------------
// 测试计划面（包含两个重叠圆 + 标签）
// ---------------------------------------------------------------------------

interface TestPlaneGroup {
  plane: ReturnType<typeof MeshBuilder.CreatePlane>
  labelPlane: ReturnType<typeof MeshBuilder.CreatePlane>
  material: StandardMaterial
  info: BlendInfo
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

  // ---- 正交摄像机 ----
  const camera = new ArcRotateCamera(
    'cam',
    -Math.PI / 2,
    Math.PI / 2,
    18,
    new Vector3(0, 0, 0),
    scene,
  )
  camera.mode = 1 // ORTHOGRAPHIC_CAMERA
  camera.orthoTop = 5
  camera.orthoBottom = -5
  camera.orthoLeft = -12
  camera.orthoRight = 12
  camera.inputs.clear()
  camera.inputs.addMouseWheel()

  // ---- 光照 ----
  const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
  light.intensity = 0.9

  // ---- 背景面板 (棋盘格) ----
  const checkerTex = createCheckerboardTexture(scene)
  const bgMat = new StandardMaterial('bgMat', scene)
  bgMat.diffuseTexture = checkerTex
  bgMat.emissiveColor = new Color3(1, 1, 1)
  bgMat.specularColor.set(0, 0, 0)
  bgMat.backFaceCulling = false
  bgMat.disableLighting = true

  const bgPlane = MeshBuilder.CreatePlane('bgPlane', { width: 24, height: 10 }, scene)
  bgPlane.position.z = -0.1
  bgPlane.material = bgMat

  // ---- 创建 10 个混合模式测试面板 ----
  const cols = 5
  const rows = 2
  const cellW = 4.2
  const cellH = 3.5
  const startX = -(cols - 1) * cellW / 2
  const startY = (rows - 1) * cellH / 2

  const testGroups: TestPlaneGroup[] = []

  for (let i = 0; i < BLEND_INFOS.length; i++) {
    const info = BLEND_INFOS[i]
    const col = i % cols
    const row = Math.floor(i / cols)
    const cx = startX + col * cellW
    const cy = startY - row * cellH

    // ---- 创建测试面板：使用 DynamicTexture 渲染两个重叠圆 ----
    const texSize = 512
    const overlayTex = new DynamicTexture(`overlay_${info.label}`, { width: texSize, height: texSize }, scene, false)
    const ctx = overlayTex.getContext() as unknown as CanvasRenderingContext2D
    // 透明背景
    ctx.clearRect(0, 0, texSize, texSize)

    const half = texSize / 2
    const radius = 100
    const offset = 40 // 两个圆的偏移

    // 圆 1：红色（左下）
    const cx1 = half - offset
    const cy1 = half + offset
    const g1 = ctx.createRadialGradient(cx1, cy1, 0, cx1, cy1, radius)
    g1.addColorStop(0, 'rgba(255,60,60,0.85)')
    g1.addColorStop(0.7, 'rgba(255,60,60,0.5)')
    g1.addColorStop(1, 'rgba(255,60,60,0.0)')
    ctx.fillStyle = g1
    ctx.beginPath()
    ctx.arc(cx1, cy1, radius, 0, Math.PI * 2)
    ctx.fill()

    // 圆 2：青色（右上）
    const cx2 = half + offset
    const cy2 = half - offset
    const g2 = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, radius)
    g2.addColorStop(0, 'rgba(60,200,255,0.85)')
    g2.addColorStop(0.7, 'rgba(60,200,255,0.5)')
    g2.addColorStop(1, 'rgba(60,200,255,0.0)')
    ctx.fillStyle = g2
    ctx.beginPath()
    ctx.arc(cx2, cy2, radius, 0, Math.PI * 2)
    ctx.fill()

    overlayTex.update(true)
    overlayTex.hasAlpha = true

    // 创建材质并设置混合模式
    const mat = new StandardMaterial(`mat_${info.label}`, scene)
    mat.diffuseTexture = overlayTex
    mat.emissiveTexture = overlayTex
    mat.emissiveColor = new Color3(1, 1, 1)
    mat.useAlphaFromDiffuseTexture = true
    mat.specularColor.set(0, 0, 0)
    mat.backFaceCulling = false
    mat.disableLighting = true
    // 设置对应的 Babylon.js alphaMode
    mat.alphaMode = info.alphaMode

    // 创建显示平面
    const plane = MeshBuilder.CreatePlane(`plane_${info.label}`, { width: 1.8, height: 1.8 }, scene)
    plane.position = new Vector3(cx, cy + 0.3, 0)
    plane.material = mat

    // 创建标签
    const labelTex = createLabelTexture(`labelTex_${info.label}`, info.label, scene)
    const labelMat = new StandardMaterial(`labelMat_${info.label}`, scene)
    labelMat.diffuseTexture = labelTex
    labelMat.emissiveTexture = labelTex
    labelMat.emissiveColor = new Color3(1, 1, 1)
    labelMat.specularColor.set(0, 0, 0)
    labelMat.backFaceCulling = false
    labelMat.disableLighting = true

    const labelPlane = MeshBuilder.CreatePlane(`labelPlane_${info.label}`, { width: 1.8, height: 0.25 }, scene)
    labelPlane.position = new Vector3(cx, cy - 0.8, 0)
    labelPlane.material = labelMat

    testGroups.push({ plane, labelPlane, material: mat, info })
  }

  // ---- UI: 混合模式列表 ----
  const blendListEl = document.getElementById('blend-list')!
  const alphaSlider = document.getElementById('alpha-slider') as HTMLInputElement
  const alphaValEl = document.getElementById('alpha-val')!
  const showBgCb = document.getElementById('show-background') as HTMLInputElement
  const showLabelsCb = document.getElementById('show-labels') as HTMLInputElement
  const singleDisplayCb = document.getElementById('single-display') as HTMLInputElement
  const quickCompareCb = document.getElementById('quick-compare') as HTMLInputElement

  let selectedBlendIdx = 0

  function renderBlendList(): void {
    blendListEl.innerHTML = ''
    for (let i = 0; i < BLEND_INFOS.length; i++) {
      const info = BLEND_INFOS[i]
      const div = document.createElement('div')
      div.className = `blend-item${i === selectedBlendIdx ? ' selected' : ''}`
      div.innerHTML = `
        <div class="swatch" style="background:linear-gradient(135deg, #ff3c3c 50%, #3cc8ff 50%);"></div>
        <div class="name">${info.label}</div>
        <div class="alpha-mode">${info.alphaModeLabel}</div>
      `
      div.addEventListener('click', () => {
        selectedBlendIdx = i
        renderBlendList()
        highlightSelectedBlend()
      })
      blendListEl.appendChild(div)
    }
  }

  function highlightSelectedBlend(): void {
    if (singleDisplayCb.checked) {
      // 仅显示选中的
      for (const g of testGroups) {
        g.plane.isVisible = g.info.mode === BLEND_INFOS[selectedBlendIdx].mode
        g.labelPlane.isVisible = g.plane.isVisible
      }
    } else {
      // 全部显示，高亮选中的
      for (const g of testGroups) {
        g.plane.isVisible = true
        g.labelPlane.isVisible = true
        // 选中项放大
        if (g.info.mode === BLEND_INFOS[selectedBlendIdx].mode) {
          g.plane.scaling.setAll(1.15)
        } else {
          g.plane.scaling.setAll(1)
        }
      }
    }
  }

  function updateAllAlpha(val: number): void {
    for (const g of testGroups) {
      // 通过调节材质的整体 alpha 来模拟全局透明度
      g.plane.visibility = val
    }
  }

  renderBlendList()

  alphaSlider.addEventListener('input', () => {
    const val = parseFloat(alphaSlider.value)
    alphaValEl.textContent = val.toFixed(2)
    updateAllAlpha(val)
  })

  showBgCb.addEventListener('change', () => {
    bgPlane.isVisible = showBgCb.checked
  })

  showLabelsCb.addEventListener('change', () => {
    for (const g of testGroups) {
      g.labelPlane.isVisible = showLabelsCb.checked
    }
  })

  singleDisplayCb.addEventListener('change', highlightSelectedBlend)

  let quickCompareActive = false
  quickCompareCb.addEventListener('change', () => {
    quickCompareActive = quickCompareCb.checked
  })

  // ---- FPS 监控 ----
  let fpsFrames = 0
  let fpsAccum = 0
  let fpsDisplay = 0
  let lastFpsUpdate = performance.now()

  engine.runRenderLoop(() => {
    if (quickCompareActive) {
      // 每 1.5 秒切换一个混合模式显示
      const idx = Math.floor(Date.now() / 1500) % BLEND_INFOS.length
      if (idx !== selectedBlendIdx) {
        selectedBlendIdx = idx
        renderBlendList()
        highlightSelectedBlend()
      }
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
}

main().catch((err: unknown) => {
  console.error('[fatal] main() failed:', err)
  const errorEl = document.getElementById('gpu-error')!
  errorEl.style.display = 'flex'
  errorEl.textContent = `初始化失败: ${err instanceof Error ? err.message : String(err)}`
})
