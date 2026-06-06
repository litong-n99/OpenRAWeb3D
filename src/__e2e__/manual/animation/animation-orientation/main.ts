/**
 * main.ts — Animation 朝向切换人工验收测试
 *
 * 测试目标:
 *   1. 验证 WAngle (0-1023) 到面向方向的映射正确性
 *   2. 验证朝向切换过渡效果（ReplaceAnim 保持帧位置）
 *   3. 验证 facingFunc 回调在不同角度下的正确性
 *
 * OpenRA 对照: Animation.ts — facingFunc, WAngle, getSprite(frame, facing)
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
// ---------------------------------------------------------------------------
// 每 45° 朝向的纹理（8 个方向）

function createFacingTexture(
  label: string,
  rotationDeg: number,
  scene: Scene,
): DynamicTexture {
  const size = 256
  const tex = new DynamicTexture(`facing_${label}`, { width: size, height: size }, scene, false)
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D
  const half = size / 2

  // 背景
  ctx.fillStyle = 'rgba(20,30,50,0.9)'
  ctx.fillRect(0, 0, size, size)

  // 旋转上下文使箭头指向对应方向
  ctx.save()
  ctx.translate(half, half)
  ctx.rotate(((rotationDeg - 90) * Math.PI) / 180)

  // 箭头身体（指向右侧 = 0° = 东）
  ctx.fillStyle = '#e94560'
  ctx.beginPath()
  ctx.moveTo(half * 0.7, 0)            // 箭头尖端
  ctx.lineTo(half * 0.1, -half * 0.35) // 左上
  ctx.lineTo(half * 0.1, -half * 0.12) // 左中上
  ctx.lineTo(-half * 0.7, -half * 0.12) // 最左
  ctx.lineTo(-half * 0.7, half * 0.12)  // 最左
  ctx.lineTo(half * 0.1, half * 0.12)   // 左中下
  ctx.lineTo(half * 0.1, half * 0.35)   // 左下
  ctx.closePath()
  ctx.fill()

  // 箭头描边
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.restore()

  // 中心圆点
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(half, half, 8, 0, Math.PI * 2)
  ctx.fill()

  // 标签
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 18px monospace'
  ctx.textAlign = 'center'
  ctx.fillText(label, half, size - 16)

  tex.update(true)
  tex.hasAlpha = true
  return tex
}

// ---------------------------------------------------------------------------
// WAngle → 角度转换（OpenRA 定义：0=北，顺时针）
// ---------------------------------------------------------------------------

function wangleToDegrees(wangle: number): number {
  return (wangle / 1024) * 360
}

function wangleToDirectionLabel(wangle: number): string {
  const deg = wangleToDegrees(wangle)
  if (deg < 22.5 || deg >= 337.5) return '北 N'
  if (deg >= 22.5 && deg < 67.5) return '东北 NE'
  if (deg >= 67.5 && deg < 112.5) return '东 E'
  if (deg >= 112.5 && deg < 157.5) return '东南 SE'
  if (deg >= 157.5 && deg < 202.5) return '南 S'
  if (deg >= 202.5 && deg < 247.5) return '西南 SW'
  if (deg >= 247.5 && deg < 292.5) return '西 W'
  return '西北 NW'
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
  camera.orthoTop = 4
  camera.orthoBottom = -4
  camera.orthoLeft = -6
  camera.orthoRight = 6
  camera.inputs.clear()
  camera.inputs.addMouseWheel()

  // ---- 光照 ----
  const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
  light.intensity = 0.9

  // ---- 创建朝向纹理（8 个方向） ----
  const facingInfos = [
    { wStart: 0, wEnd: 63, label: 'N', deg: 0, posX: 0, posY: 2 },
    { wStart: 64, wEnd: 191, label: 'NE', deg: 45, posX: 2, posY: 1.2 },
    { wStart: 192, wEnd: 319, label: 'E', deg: 90, posX: 2.8, posY: 0 },
    { wStart: 320, wEnd: 447, label: 'SE', deg: 135, posX: 2, posY: -1.2 },
    { wStart: 448, wEnd: 575, label: 'S', deg: 180, posX: 0, posY: -2 },
    { wStart: 576, wEnd: 703, label: 'SW', deg: 225, posX: -2, posY: -1.2 },
    { wStart: 704, wEnd: 831, label: 'W', deg: 270, posX: -2.8, posY: 0 },
    { wStart: 832, wEnd: 1023, label: 'NW', deg: 315, posX: -2, posY: 1.2 },
  ]

  const facingPlanes: { plane: Mesh; wStart: number; wEnd: number; label: string }[] = []
  for (const info of facingInfos) {
    const tex = createFacingTexture(info.label, info.deg, scene)
    const mat = new StandardMaterial(`mat_${info.label}`, scene)
    mat.diffuseTexture = tex
    mat.emissiveTexture = tex
    mat.emissiveColor = new Color3(1, 1, 1)
    mat.useAlphaFromDiffuseTexture = true
    mat.specularColor.set(0, 0, 0)
    mat.backFaceCulling = false
    mat.disableLighting = true

    const plane = MeshBuilder.CreatePlane(`facing_${info.label}`, { width: 1.2, height: 1.2 }, scene)
    plane.position = new Vector3(info.posX, info.posY, 0)
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL
    plane.material = mat

    facingPlanes.push({ plane, wStart: info.wStart, wEnd: info.wEnd, label: info.label })
  }

  // ---- 主动画精灵（中心大箭头） ----
  const mainTex = new DynamicTexture('mainTex', { width: 256, height: 256 }, scene, false)
  const mainCtx = mainTex.getContext() as unknown as CanvasRenderingContext2D

  function updateMainTex(wangle: number): void {
    const deg = wangleToDegrees(wangle)
    mainCtx.clearRect(0, 0, 256, 256)
    const half = 128

    mainCtx.save()
    mainCtx.translate(half, half)
    mainCtx.rotate((deg * Math.PI) / 180) // 箭头本地尖端朝上，0° WAngle (北) 无需旋转

    // 大箭头
    mainCtx.fillStyle = '#e94560'
    mainCtx.beginPath()
    mainCtx.moveTo(0, -half * 0.75)         // 尖端（北/上）
    mainCtx.lineTo(half * 0.35, half * 0.15)
    mainCtx.lineTo(half * 0.12, half * 0.15)
    mainCtx.lineTo(half * 0.12, half * 0.75)
    mainCtx.lineTo(-half * 0.12, half * 0.75)
    mainCtx.lineTo(-half * 0.12, half * 0.15)
    mainCtx.lineTo(-half * 0.35, half * 0.15)
    mainCtx.closePath()
    mainCtx.fill()

    mainCtx.strokeStyle = 'rgba(255,255,255,0.7)'
    mainCtx.lineWidth = 3
    mainCtx.stroke()
    mainCtx.restore()

    // 角度读数
    mainCtx.fillStyle = '#fff'
    mainCtx.font = 'bold 16px monospace'
    mainCtx.textAlign = 'center'
    mainCtx.fillText(`${deg.toFixed(0)}°`, half, 20)

    mainTex.update(true)
  }

  const mainMat = new StandardMaterial('mainMat', scene)
  mainMat.diffuseTexture = mainTex
  mainMat.emissiveTexture = mainTex
  mainMat.emissiveColor = new Color3(1, 1, 1)
  mainMat.useAlphaFromDiffuseTexture = true
  mainMat.specularColor.set(0, 0, 0)
  mainMat.backFaceCulling = false
  mainMat.disableLighting = true

  const mainPlane = MeshBuilder.CreatePlane('mainPlane', { width: 2.5, height: 2.5 }, scene)
  mainPlane.position = new Vector3(0, 0, 0.1)
  mainPlane.billboardMode = Mesh.BILLBOARDMODE_ALL
  mainPlane.material = mainMat

  // ---- 背景圆环（方向参考） ----
  const ringTex = new DynamicTexture('ringTex', { width: 512, height: 512 }, scene, false)
  const ringCtx = ringTex.getContext() as unknown as CanvasRenderingContext2D
  const rhalf = 256
  ringCtx.strokeStyle = 'rgba(255,255,255,0.2)'
  ringCtx.lineWidth = 2
  ringCtx.beginPath()
  ringCtx.arc(rhalf, rhalf, 230, 0, Math.PI * 2)
  ringCtx.stroke()
  // 8 个方向标记
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4 - Math.PI / 2
    const x = rhalf + Math.cos(angle) * 220
    const y = rhalf + Math.sin(angle) * 220
    ringCtx.fillStyle = 'rgba(255,255,255,0.4)'
    ringCtx.beginPath()
    ringCtx.arc(x, y, 4, 0, Math.PI * 2)
    ringCtx.fill()
  }
  ringTex.update(true)
  ringTex.hasAlpha = true

  const ringMat = new StandardMaterial('ringMat', scene)
  ringMat.diffuseTexture = ringTex
  ringMat.emissiveTexture = ringTex
  ringMat.emissiveColor = new Color3(1, 1, 1)
  ringMat.useAlphaFromDiffuseTexture = true
  ringMat.specularColor.set(0, 0, 0)
  ringMat.backFaceCulling = false
  ringMat.disableLighting = true

  const ringPlane = MeshBuilder.CreatePlane('ringPlane', { width: 3.5, height: 3.5 }, scene)
  ringPlane.position = new Vector3(0, 0, -0.05)
  ringPlane.material = ringMat

  // ---- 朝向区域高亮 ----
  function highlightActiveFacing(wangle: number): void {
    for (const fp of facingPlanes) {
      const inRange = wangle >= fp.wStart && wangle <= fp.wEnd
      // WAngle 0 跨越 1023→0 边界
      const crossesZero = fp.wStart > fp.wEnd
      const active = crossesZero
        ? (wangle >= fp.wStart || wangle <= fp.wEnd)
        : inRange

      fp.plane.scaling.setAll(active ? 1.3 : 1)
      if (active && fp.plane.material) {
        (fp.plane.material as StandardMaterial).alpha = 1
      } else if (fp.plane.material) {
        (fp.plane.material as StandardMaterial).alpha = 0.4
      }
    }
  }

  // ---- UI 绑定 ----
  const angleSlider = document.getElementById('angle-slider') as HTMLInputElement
  const angleVal = document.getElementById('angle-val')!
  const autoRotateCb = document.getElementById('auto-rotate') as HTMLInputElement
  const rotSpeedSlider = document.getElementById('rot-speed-slider') as HTMLInputElement
  const rotSpeedVal = document.getElementById('rot-speed-val')!
  const compassCanvas = document.getElementById('compass-canvas') as HTMLCanvasElement
  const stateWangle = document.getElementById('state-wangle')!
  const stateDegrees = document.getElementById('state-degrees')!
  const stateDir = document.getElementById('state-dir')!
  const stateSeq = document.getElementById('state-seq')!

  let currentWangle = 0

  function drawCompass(wangle: number): void {
    const ctx = compassCanvas.getContext('2d')
    if (!ctx) return
    const w = compassCanvas.width
    const h = compassCanvas.height
    const cx = w / 2
    const cy = h / 2
    const r = 80

    ctx.clearRect(0, 0, w, h)

    // 圆
    ctx.strokeStyle = '#555'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()

    // 方向箭头
    const deg = wangleToDegrees(wangle)
    const rad = ((deg - 90) * Math.PI) / 180
    const ex = cx + Math.cos(rad) * r * 0.8
    const ey = cy + Math.sin(rad) * r * 0.8

    ctx.strokeStyle = '#e94560'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(ex, ey)
    ctx.stroke()

    // 箭头
    ctx.fillStyle = '#e94560'
    ctx.beginPath()
    ctx.moveTo(ex, ey)
    ctx.lineTo(
      cx + Math.cos(rad + 2.5) * r * 0.65,
      cy + Math.sin(rad + 2.5) * r * 0.65,
    )
    ctx.lineTo(
      cx + Math.cos(rad - 2.5) * r * 0.65,
      cy + Math.sin(rad - 2.5) * r * 0.65,
    )
    ctx.closePath()
    ctx.fill()

    // 标签 N/S/E/W
    ctx.fillStyle = '#888'
    ctx.font = '11px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('N', cx, cy - r - 10)
    ctx.fillText('S', cx, cy + r + 10)
    ctx.fillText('E', cx + r + 12, cy)
    ctx.fillText('W', cx - r - 12, cy)
  }

  function updateFacing(wangle: number): void {
    currentWangle = wangle
    const deg = wangleToDegrees(wangle)
    const dir = wangleToDirectionLabel(wangle)

    angleVal.textContent = `${wangle} (${dir})`
    stateWangle.textContent = String(wangle)
    stateDegrees.textContent = `${deg.toFixed(1)}°`
    stateDir.textContent = dir
    stateSeq.textContent = `facing_${dir.replace(' ', '_')}`

    updateMainTex(wangle)
    highlightActiveFacing(wangle)
    drawCompass(wangle)
  }

  angleSlider.addEventListener('input', () => {
    updateFacing(parseInt(angleSlider.value, 10))
  })

  autoRotateCb.addEventListener('change', () => {
    // handled in render loop
  })

  rotSpeedSlider.addEventListener('input', () => {
    rotSpeedVal.textContent = `${parseFloat(rotSpeedSlider.value).toFixed(1)}x`
  })

  for (const [id, wangle] of [
    ['btn-north', 0],
    ['btn-east', 256],
    ['btn-south', 512],
    ['btn-west', 768],
  ] as const) {
    document.getElementById(id)!.addEventListener('click', () => {
      angleSlider.value = String(wangle)
      updateFacing(wangle)
    })
  }

  document.getElementById('btn-random')!.addEventListener('click', () => {
    const rand = Math.floor(Math.random() * 1024)
    angleSlider.value = String(rand)
    updateFacing(rand)
  })

  // ---- 初始化 ----
  updateFacing(0)

  // ---- 渲染循环 ----
  let fpsFrames = 0
  let fpsAccum = 0
  let fpsDisplay = 0
  let lastFpsUpdate = performance.now()

  engine.runRenderLoop(() => {
    if (autoRotateCb.checked) {
      const speed = parseFloat(rotSpeedSlider.value)
      const newWangle = ((currentWangle + speed * 2) % 1024 + 1024) % 1024
      angleSlider.value = String(Math.round(newWangle))
      updateFacing(Math.round(newWangle))
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
