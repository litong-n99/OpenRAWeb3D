/**
 * main.ts — RgbaColorRenderer Debug 图形渲染人工验收测试
 *
 * 测试目标:
 *   1. 验证线条 (DrawLine)、矩形边框 (DrawRect)、填充矩形 (FillRect) 的几何正确性
 *   2. 验证椭圆 (FillEllipse) 的扫描线近似质量
 *   3. 验证 ShaderMaterial 逐顶点颜色的正确性
 *
 * OpenRA 对照: RgbaColorRenderer.cs — DrawLine, DrawRect, FillRect, FillEllipse, DrawPolygon
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

// ---------------------------------------------------------------------------
// 内联着色器（与 RgbaColorRenderer 一致）
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
// 向量工具
// ---------------------------------------------------------------------------

interface Vec2 { x: number; y: number }
interface Vec3 { x: number; y: number; z: number }
interface Rgba { r: number; g: number; b: number; a: number }

function hexToColor(hex: string): Rgba {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
    a: 1.0,
  }
}

// ---------------------------------------------------------------------------
// Debug 图形构建器
// ---------------------------------------------------------------------------

class DebugGraphicsBuilder {
  private vertices: number[] = []  // [x,y,z, r,g,b,a, ...]
  private indices: number[] = []
  private vertexBase = 0

  addVertex(x: number, y: number, z: number, c: Rgba): void {
    this.vertices.push(x, y, z, c.r, c.g, c.b, c.a)
  }

  addQuad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: Rgba): void {
    const base = this.vertexBase
    this.addVertex(a.x, a.y, a.z, color)
    this.addVertex(b.x, b.y, b.z, color)
    this.addVertex(c.x, c.y, c.z, color)
    this.addVertex(d.x, d.y, d.z, color)
    this.indices.push(base, base + 1, base + 2, base + 2, base + 3, base)
    this.vertexBase += 4
  }

  /**
   * 绘制线段（展开为四边形）
   */
  drawLine(sx: number, sy: number, ex: number, ey: number, width: number, color: Rgba, z = 0): void {
    const dx = ex - sx
    const dy = ey - sy
    const len = Math.sqrt(dx * dx + dy * dy) || 1e-9
    const nx = -dy / len * width / 2
    const ny = dx / len * width / 2

    const a: Vec3 = { x: sx - nx, y: sy - ny, z }
    const b: Vec3 = { x: sx + nx, y: sy + ny, z }
    const c: Vec3 = { x: ex + nx, y: ey + ny, z }
    const d: Vec3 = { x: ex - nx, y: ey - ny, z }
    this.addQuad(a, b, c, d, color)
  }

  /**
   * 绘制矩形边框
   */
  drawRect(x1: number, y1: number, x2: number, y2: number, width: number, color: Rgba, z = 0): void {
    this.drawLine(x1, y1, x2, y1, width, color, z) // top
    this.drawLine(x2, y1, x2, y2, width, color, z) // right
    this.drawLine(x2, y2, x1, y2, width, color, z) // bottom
    this.drawLine(x1, y2, x1, y1, width, color, z) // left
  }

  /**
   * 填充矩形
   */
  fillRect(x1: number, y1: number, x2: number, y2: number, color: Rgba, z = 0): void {
    const a: Vec3 = { x: x1, y: y1, z }
    const b: Vec3 = { x: x2, y: y1, z }
    const c: Vec3 = { x: x2, y: y2, z }
    const d: Vec3 = { x: x1, y: y2, z }
    this.addQuad(a, b, c, d, color)
  }

  /**
   * 填充椭圆（扫描线法）
   */
  fillEllipse(cx: number, cy: number, rx: number, ry: number, color: Rgba, z = 0): void {
    const startY = Math.ceil(cy - ry)
    const endY = Math.floor(cy + ry)
    for (let y = startY; y <= endY; y++) {
      const dy = (y - cy) / (ry || 1e-9)
      const disc = 1 - dy * dy
      if (disc <= 0) continue
      const dx = rx * Math.sqrt(disc)
      this.drawLine(cx - dx, y, cx + dx, y, 1, color, z)
    }
  }

  /**
   * 填充多边形（五角星等）
   */
  fillPolygon(points: Vec2[], color: Rgba, z = 0): void {
    if (points.length < 3) return
    // 凸多边形扇形三角剖分 (fan triangulation)
    // 使用退化 quad (a,b,c,c) 模拟三角形，避免引入独立的三角形方法
    const base = points[0]
    for (let i = 1; i < points.length - 1; i++) {
      const a: Vec3 = { x: base.x, y: base.y, z }
      const b: Vec3 = { x: points[i].x, y: points[i].y, z }
      const c: Vec3 = { x: points[i + 1].x, y: points[i + 1].y, z }
      this.addQuad(a, b, c, c, color)
    }
  }

  buildMesh(scene: Scene): Mesh {
    const vertexData = new VertexData()
    vertexData.positions = new Float32Array(this.vertices.length / 7 * 3)
    vertexData.colors = new Float32Array(this.vertices.length / 7 * 4)
    vertexData.indices = new Uint32Array(this.indices)

    let pi = 0, ci = 0
    for (let i = 0; i < this.vertices.length; i += 7) {
      vertexData.positions![pi++] = this.vertices[i]
      vertexData.positions![pi++] = this.vertices[i + 1]
      vertexData.positions![pi++] = this.vertices[i + 2]
      vertexData.colors![ci++] = this.vertices[i + 3]
      vertexData.colors![ci++] = this.vertices[i + 4]
      vertexData.colors![ci++] = this.vertices[i + 5]
      vertexData.colors![ci++] = this.vertices[i + 6]
    }

    const mesh = new Mesh('debugGraphics', scene)
    vertexData.applyToMesh(mesh, false)

    const mat = new ShaderMaterial('debugMat', scene, {
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

    mesh.material = mat
    return mesh
  }

  get quadCount(): number {
    return this.indices.length / 6
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

  // alpha=-PI/2, beta=PI/2: camera at (0,0,-10) looking along +Z at the XY plane.
  // ArcRotateCamera pos = (R*cos(alpha)*sin(beta), R*cos(beta), R*sin(alpha)*sin(beta))
  //   = (10*0*1, 10*0, 10*(-1)*1) = (0,0,-10).
  // View Z = normalize(target-pos) = (0,0,1). View X = cross(up,forward) = (1,0,0).
  // So viewX = worldX, viewY = worldY. No flip.
  // orthoLeft=-8..right=8 maps to worldX=-8..8, orthoBottom=-5..top=5 maps to worldY=-5..5.
  const camera = new ArcRotateCamera('cam', -Math.PI / 2, Math.PI / 2, 10, new Vector3(0, 0, 0), scene)
  camera.mode = 1
  camera.orthoTop = 5
  camera.orthoBottom = -5
  camera.orthoLeft = -8
  camera.orthoRight = 8
  camera.inputs.clear()
  camera.inputs.addMouseWheel()

  const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
  light.intensity = 0.9

  // ---- 构建 Debug 图形 ----
  type ShapeFilter = 'all' | 'lines' | 'rect' | 'fillrect' | 'ellipse' | 'polygon'

  interface BuildResult {
    mesh: Mesh
    quadCount: number
  }

  function buildShapes(lineColorHex: string, fillColorHex: string, lineWidth: number, filter: ShapeFilter): BuildResult {
    const builder = new DebugGraphicsBuilder()
    const lineC = hexToColor(lineColorHex)
    const fillC = hexToColor(fillColorHex)
    const show = (type: ShapeFilter) => filter === 'all' || filter === type

    if (show('lines')) {
      // 区域 1: 线条 (左上)
      builder.drawLine(-6.5, 3, -4, 3, lineWidth, lineC)
      builder.drawLine(-6.5, 2.5, -4, 4, lineWidth, lineC) // 对角线
      builder.drawLine(-6.5, 2, -6.5, 4, lineWidth, { ...lineC, r: 1, g: 0.9, b: 0.2 }) // 竖线 (黄色)
      builder.drawLine(-6.5, 1.5, -4, 1.5, lineWidth, { ...lineC, r: 0.2, g: 0.9, b: 1 }) // 横线 (青色)
    }

    if (show('rect')) {
      // 区域 2: 矩形边框 (中上)
      builder.drawRect(-3.2, 3.2, -1, 1.8, lineWidth, lineC)
    }

    if (show('fillrect')) {
      // 区域 3: 填充矩形 (右上)
      builder.fillRect(-0.3, 3.2, 1.8, 1.8, fillC)
      builder.drawRect(-0.3, 3.2, 1.8, 1.8, 0.5, { ...lineC, a: 0.5 })
      // 区域 5: 嵌套矩形 (右下)
      builder.fillRect(0, 0.5, 3, -2, { ...fillC, a: 0.5 })
      builder.drawRect(0, 0.5, 3, -2, 1.5, lineC)
    }

    if (show('ellipse')) {
      // 区域 4: 椭圆 (中)
      builder.fillEllipse(-5, -0.5, 1.2, 1.8, fillC)
      builder.fillEllipse(-2.5, -0.5, 0.6, 1.5, { ...lineC, a: 0.7 })
    }

    if (show('polygon')) {
      // 区域 6: 五角星 (左下)
      const starPts: Vec2[] = []
      const starCx = -5.5, starCy = -3, outerR = 1.2, innerR = 0.5
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outerR : innerR
        const angle = (i * Math.PI) / 5 - Math.PI / 2
        starPts.push({ x: starCx + Math.cos(angle) * r, y: starCy + Math.sin(angle) * r })
      }
      builder.fillPolygon(starPts, { ...lineC, a: 0.8 })
    }

    const mesh = builder.buildMesh(scene)
    return { mesh, quadCount: builder.quadCount }
  }

  let currentResult = buildShapes('#e94560', '#2ecc71', 2, 'all')
  currentResult.mesh.renderingGroupId = 3
  document.getElementById('state-quads')!.textContent = String(currentResult.quadCount)

  // ---- UI 绑定 ----
  const widthSlider = document.getElementById('width-slider') as HTMLInputElement
  const widthVal = document.getElementById('width-val')!
  const lineColorInput = document.getElementById('line-color') as HTMLInputElement
  const fillColorInput = document.getElementById('fill-color') as HTMLInputElement
  const shapeSelect = document.getElementById('shape-select') as HTMLSelectElement

  function rebuild(): void {
    currentResult.mesh.dispose()
    const lw = parseFloat(widthSlider.value)
    const filter = shapeSelect.value as ShapeFilter
    currentResult = buildShapes(lineColorInput.value, fillColorInput.value, lw, filter)
    currentResult.mesh.renderingGroupId = 3
    document.getElementById('state-quads')!.textContent = String(currentResult.quadCount)
  }

  shapeSelect.addEventListener('change', rebuild)

  widthSlider.addEventListener('input', () => {
    widthVal.textContent = widthSlider.value
    rebuild()
  })

  document.getElementById('apply-colors')!.addEventListener('click', rebuild)

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
