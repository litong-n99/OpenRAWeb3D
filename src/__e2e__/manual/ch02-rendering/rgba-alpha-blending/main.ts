/**
 * main.ts — RgbaColorRenderer 预乘 Alpha 混合人工验收测试
 *
 * 测试目标:
 *   1. 验证 ALPHA_PREMULTIPLIED 模式下的半透明效果正确性
 *   2. 验证 premultiplyAlpha() 函数对颜色分量的预乘效果
 *   3. 验证多个半透明形状叠加时的视觉混合效果
 *
 * OpenRA 对照: RgbaColorRenderer.ts — premultiplyAlpha(), ALPHA_PREMULTIPLIED, vertexWithColor()
 */

import { Engine } from '@babylonjs/core'
import { Scene } from '@babylonjs/core'
import { ArcRotateCamera } from '@babylonjs/core'
import { HemisphericLight } from '@babylonjs/core'
import { Vector3 } from '@babylonjs/core'
import { Color4 } from '@babylonjs/core'
import { Mesh } from '@babylonjs/core'
import { VertexData } from '@babylonjs/core'
import { ShaderMaterial } from '@babylonjs/core'

import {
  premultiplyAlpha,
} from '../../../../OpenRA.Game/Graphics/RgbaColorRenderer'

// ---------------------------------------------------------------------------
// 着色器
// ---------------------------------------------------------------------------

const VERTEX_SHADER = /* glsl */`
precision highp float;
attribute vec3 position;
attribute vec4 color;
varying vec4 vColor;
uniform mat4 worldViewProjection;
void main(void) {
  gl_Position = worldViewProjection * vec4(position, 1.0);
  vColor = color;
}
`

const FRAGMENT_SHADER = /* glsl */`
precision highp float;
varying vec4 vColor;
void main(void) {
  gl_FragColor = vColor;
}
`

// ---------------------------------------------------------------------------
// 颜色工具
// ---------------------------------------------------------------------------

function hexToRgba255(hex: string): { r: number; g: number; b: number; a: number } {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: 255,
  }
}

// ---------------------------------------------------------------------------
// 构建重叠条网格
// ---------------------------------------------------------------------------

function buildOverlapBars(
  colors255: { r: number; g: number; b: number; a: number }[],
  numBars: number,
  globalAlpha: number,
  barWidth: number,
  barHeight: number,
  overlapFraction: number,
): { positions: Float32Array; colors: Float32Array; indices: Uint32Array } {
  const halfW = barWidth / 2
  const halfH = barHeight / 2
  const totalWidth = barWidth * numBars - barWidth * overlapFraction * (numBars - 1)
  const startX = -totalWidth / 2

  const positions: number[] = []
  const clrs: number[] = []
  const indices: number[] = []

  for (let i = 0; i < numBars; i++) {
    const cx = startX + barWidth * i - barWidth * overlapFraction * i
    const c255 = colors255[i % colors255.length]

    // 预乘 Alpha
    const alpha255 = Math.round(c255.a * globalAlpha)
    const rawColor = { r: c255.r, g: c255.g, b: c255.b, a: alpha255 }
    const premul = premultiplyAlpha(rawColor)

    // 归一化
    const inv255 = 1 / 255
    const r = premul.r * inv255
    const g = premul.g * inv255
    const b = premul.b * inv255
    const a = premul.a * inv255

    const base = positions.length / 3
    // 4 个角点 (XY plane)
    positions.push(
      cx - halfW, halfH, 0,    // 左上
      cx + halfW, halfH, 0,    // 右上
      cx + halfW, -halfH, 0,   // 右下
      cx - halfW, -halfH, 0,   // 左下
    )
    clrs.push(
      r, g, b, a,
      r, g, b, a,
      r, g, b, a,
      r, g, b, a,
    )
    indices.push(base, base + 1, base + 2, base + 2, base + 3, base)
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(clrs),
    indices: new Uint32Array(indices),
  }
}

// ---------------------------------------------------------------------------
// 主函数
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
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

  // ---- Babylon.js ----
  const sandboxEl = document.getElementById('sandbox')!
  const canvas = document.createElement('canvas')
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.width = Math.max(sandboxEl.getBoundingClientRect().width || 800, 1)
  canvas.height = Math.max(sandboxEl.getBoundingClientRect().height || 600, 1)
  sandboxEl.appendChild(canvas)

  let engine: Engine
  try {
    engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false, antialias: false })
  } catch {
    document.getElementById('gpu-error')!.style.display = 'flex'
    infoEngine.textContent = 'UNAVAILABLE'
    return
  }
  infoEngine.textContent = `Babylon.js v${Engine.Version} / WebGL ${engine.webGLVersion}.0`

  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.08, 0.09, 0.12, 1)

  const camera = new ArcRotateCamera('cam', -Math.PI / 2, Math.PI / 2, 8, new Vector3(0, 0, 0), scene)
  camera.mode = 1
  camera.orthoTop = 3
  camera.orthoBottom = -3
  camera.orthoLeft = -5
  camera.orthoRight = 5
  camera.inputs.clear()
  camera.inputs.addMouseWheel()

  const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
  light.intensity = 0.9

  // ---- ShaderMaterial ----
  const mat = new ShaderMaterial('alphaMat', scene, {
    vertexSource: VERTEX_SHADER,
    fragmentSource: FRAGMENT_SHADER,
  }, {
    attributes: ['position', 'color'],
    uniforms: ['worldViewProjection'],
    needAlphaBlending: true,
  })
  mat.alphaMode = Engine.ALPHA_PREMULTIPLIED
  mat.backFaceCulling = false
  mat.disableDepthWrite = true

  const mesh = new Mesh('alphaBars', scene)
  mesh.material = mat

  // ---- 辅助：更新网格 ----
  const colorLeft = document.getElementById('color-left') as HTMLInputElement
  const colorMid = document.getElementById('color-mid') as HTMLInputElement
  const colorRight = document.getElementById('color-right') as HTMLInputElement
  const alphaSlider = document.getElementById('alpha-slider') as HTMLInputElement
  const alphaVal = document.getElementById('alpha-val')!
  const fadeSlider = document.getElementById('fade-slider') as HTMLInputElement
  const fadeVal = document.getElementById('fade-val')!

  function updateMesh(): void {
    const colors255 = [
      hexToRgba255(colorLeft.value),
      hexToRgba255(colorMid.value),
      hexToRgba255(colorRight.value),
    ]
    const globalAlpha = parseFloat(alphaSlider.value)
    const numBars = 3
    const data = buildOverlapBars(colors255, numBars, globalAlpha, 2.2, 3, 0.35)

    const vd = new VertexData()
    vd.positions = data.positions
    vd.colors = data.colors
    vd.indices = data.indices
    vd.applyToMesh(mesh, true)

    // 更新参考信息
    const a = globalAlpha
    const c0 = colors255[0], c1 = colors255[1], c2 = colors255[2]
    document.getElementById('ref-rg')!.textContent =
      `rgba(${blend(c0.r, c1.r, a)},${blend(c0.g, c1.g, a)},${blend(c0.b, c1.b, a)},${blend(c0.a, c1.a, a)})`
    document.getElementById('ref-gb')!.textContent =
      `rgba(${blend(c1.r, c2.r, a)},${blend(c1.g, c2.g, a)},${blend(c1.b, c2.b, a)},${blend(c1.a, c2.a, a)})`
  }

  function blend(v1: number, v2: number, alpha: number): number {
    // 预乘 Alpha 混合: C_out = C_src + C_dst * (1 - alpha_src)
    const pm1 = Math.round(v1 * alpha)
    const pm2 = Math.round(v2 * (1 - alpha))
    return Math.min(255, pm1 + pm2)
  }

  // ---- UI 绑定 ----
  alphaSlider.addEventListener('input', () => {
    alphaVal.textContent = parseFloat(alphaSlider.value).toFixed(2)
    updateMesh()
  })

  fadeSlider.addEventListener('input', () => {
    fadeVal.textContent = parseFloat(fadeSlider.value) === 0 ? '垂直' : '水平'
    updateMesh()
  })

  document.getElementById('apply-colors')!.addEventListener('click', updateMesh)

  // ---- 初始化 ----
  updateMesh()

  // ---- FPS ----
  let fpsFrames = 0, fpsAccum = 0, fpsDisplay = 0, lastFpsUpdate = performance.now()

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

  const ro = new ResizeObserver(() => {
    engine.resize()
    infoViewport.textContent = `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
  })
  ro.observe(canvas)
}

main().catch((err: unknown) => {
  console.error('[fatal] main() failed:', err)
  const errorEl = document.getElementById('gpu-error')!
  errorEl.style.display = 'flex'
  errorEl.textContent = `初始化失败: ${err instanceof Error ? err.message : String(err)}`
})
