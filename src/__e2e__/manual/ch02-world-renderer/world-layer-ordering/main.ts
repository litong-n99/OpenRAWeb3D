/**
 * main.ts — WorldRenderer renderingGroupId 分层渲染人工验收测试
 *
 * 测试目标:
 *   1. 验证 RenderGroup.Terrain(0) < Actor(1) < Overlay(2) < Annotation(3) 层级顺序
 *   2. 验证重叠时 renderingGroupId 高的始终在上，不受 3D 位置影响
 *   3. 验证各层独立可见性切换的正确性
 *
 * OpenRA 对照: WorldRenderer.ts — RenderGroup 枚举, configureRenderingGroups()
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
// 图层信息
// ---------------------------------------------------------------------------

interface LayerInfo {
  groupId: number
  name: string
  label: string
  color: { r: number; g: number; b: number }
  z: number  // 3D Z 位置
}

const LAYERS: LayerInfo[] = [
  { groupId: 0, name: 'Terrain', label: 'Terrain (0) - 地形', color: { r: 70, g: 130, b: 70 }, z: 0.1 },
  { groupId: 1, name: 'Actor', label: 'Actor (1) - 对象', color: { r: 180, g: 140, b: 60 }, z: 0.05 },
  { groupId: 2, name: 'Overlay', label: 'Overlay (2) - 覆盖', color: { r: 60, g: 140, b: 200 }, z: 0.0 },
  { groupId: 3, name: 'Annotation', label: 'Annotation (3) - 注释', color: { r: 200, g: 60, b: 80 }, z: -0.05 },
]

// ---------------------------------------------------------------------------
// 创建带标签的圆形纹理
// ---------------------------------------------------------------------------

function createCircleTexture(layer: LayerInfo, size: number, scene: Scene): DynamicTexture {
  const tex = new DynamicTexture(`circle_${layer.name}`, { width: size, height: size }, scene, false)
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D
  const half = size / 2
  const r = size * 0.45

  // 填充圆
  ctx.fillStyle = `rgba(${layer.color.r},${layer.color.g},${layer.color.b},0.85)`
  ctx.beginPath()
  ctx.arc(half, half, r, 0, Math.PI * 2)
  ctx.fill()

  // 描边
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'
  ctx.lineWidth = 3
  ctx.stroke()

  // 标签
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 24px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(layer.name, half, half)

  tex.update(true)
  tex.hasAlpha = true
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
  camera.inputs.clear()
  camera.inputs.addMouseWheel()

  function updateOrtho(zoom: number): void {
    const v = 4 / zoom
    camera.orthoTop = v
    camera.orthoBottom = -v
    camera.orthoLeft = -v * 1.5
    camera.orthoRight = v * 1.5
  }
  updateOrtho(1)

  // ---- 光照 ----
  const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
  light.intensity = 0.9

  // ---- 创建 4 层重叠圆 ----
  // 每层有多个圆在网格中，故意重叠以展示层级顺序
  const circlePlanes: { plane: Mesh; layer: LayerInfo; baseX: number }[] = []
  const circleSize = 2.2
  const offset = 0.7  // 圆之间的偏移（产生重叠）

  for (const layer of LAYERS) {
    const tex = createCircleTexture(layer, 256, scene)
    const mat = new StandardMaterial(`mat_${layer.name}`, scene)
    mat.diffuseTexture = tex
    mat.emissiveTexture = tex
    mat.emissiveColor = new Color3(1, 1, 1)
    mat.useAlphaFromDiffuseTexture = true
    mat.specularColor.set(0, 0, 0)
    mat.backFaceCulling = false
    mat.disableLighting = true

    // 每层创建 3 个圆，在不同位置产生重叠
    for (let col = 0; col < 3; col++) {
      const plane = MeshBuilder.CreatePlane(
        `circle_${layer.name}_${col}`,
        { width: circleSize, height: circleSize },
        scene,
      )
      const baseX = -3 + col * offset
      plane.position = new Vector3(baseX, 0, layer.z)
      plane.material = mat
      plane.renderingGroupId = layer.groupId
      circlePlanes.push({ plane, layer, baseX })
    }
  }

  // ---- 侧边栏布局显示图层标签 ----
  for (let i = 0; i < LAYERS.length; i++) {
    const layer = LAYERS[i]
    const labTex = createLabelTex(layer.label, scene)
    const labMat = new StandardMaterial(`labMat_${layer.name}`, scene)
    labMat.diffuseTexture = labTex
    labMat.emissiveTexture = labTex
    labMat.emissiveColor = new Color3(1, 1, 1)
    labMat.specularColor.set(0, 0, 0)
    labMat.backFaceCulling = false
    labMat.disableLighting = true

    const labPlane = MeshBuilder.CreatePlane(`lab_${layer.name}`, { width: 3, height: 0.4 }, scene)
    labPlane.position = new Vector3(4.5, 1.5 - i * 1.1, 0)
    labPlane.material = labMat
    labPlane.billboardMode = Mesh.BILLBOARDMODE_ALL
    labPlane.renderingGroupId = 3 // 标签在顶层
  }

  // ---- UI: 图层图例 ----
  const legendEl = document.getElementById('layer-legend')!
  const showAllCb = document.getElementById('show-all') as HTMLInputElement
  const offsetSlider = document.getElementById('offset-slider') as HTMLInputElement
  const offsetValEl = document.getElementById('offset-val')!
  const zoomSlider = document.getElementById('zoom-slider') as HTMLInputElement
  const zoomValEl = document.getElementById('zoom-val')!

  const layerCheckboxes: HTMLInputElement[] = []

  for (const layer of LAYERS) {
    const div = document.createElement('div')
    div.className = 'layer-item'
    div.innerHTML = `
      <div class="swatch" style="background:rgb(${layer.color.r},${layer.color.g},${layer.color.b});"></div>
      <div class="name">${layer.name}</div>
      <div class="groupId">ID: ${layer.groupId}</div>
      <label style="margin:0;"><input type="checkbox" class="layer-cb" data-group="${layer.groupId}" checked></label>
    `
    legendEl.appendChild(div)
    const cb = div.querySelector('input') as HTMLInputElement
    layerCheckboxes.push(cb)

    cb.addEventListener('change', () => {
      const gid = parseInt(cb.dataset.group || '0')
      for (const cp of circlePlanes) {
        if (cp.layer.groupId === gid) {
          cp.plane.isVisible = cb.checked
        }
      }
      updateLayerStates()
    })
  }

  function updateLayerStates(): void {
    for (const layer of LAYERS) {
      const stateEl = document.getElementById(`state-${layer.name.toLowerCase()}`)
      if (stateEl) {
        const visible = circlePlanes.some(cp => cp.layer.groupId === layer.groupId && cp.plane.isVisible)
        stateEl.textContent = visible ? '可见' : '隐藏'
      }
    }
  }

  showAllCb.addEventListener('change', () => {
    for (const cb of layerCheckboxes) {
      cb.checked = showAllCb.checked
      cb.dispatchEvent(new Event('change'))
    }
  })

  offsetSlider.addEventListener('input', () => {
    const val = parseFloat(offsetSlider.value)
    offsetValEl.textContent = val.toFixed(2)
    // 移动 circlePlanes 以调整重叠量
    for (const cp of circlePlanes) {
      cp.plane.position.x = cp.baseX + val
    }
  })

  zoomSlider.addEventListener('input', () => {
    const val = parseFloat(zoomSlider.value)
    zoomValEl.textContent = `${val.toFixed(1)}x`
    updateOrtho(val)
  })

  document.getElementById('reset-view')!.addEventListener('click', () => {
    offsetSlider.value = '0'
    offsetValEl.textContent = '0.00'
    zoomSlider.value = '1'
    zoomValEl.textContent = '1.0x'
    for (const cp of circlePlanes) {
      cp.plane.position.x = cp.baseX
    }
    updateOrtho(1)
  })

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

  updateLayerStates()
}

main().catch((err: unknown) => {
  console.error('[fatal] main() failed:', err)
  const errorEl = document.getElementById('gpu-error')!
  errorEl.style.display = 'flex'
  errorEl.textContent = `初始化失败: ${err instanceof Error ? err.message : String(err)}`
})
