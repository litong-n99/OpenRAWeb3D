/**
 * main.ts -- GameActor 3D 场景渲染人工验收测试
 *
 * 测试目标:
 *   1. 验证 GameActor (TransformNode) 在场景中的创建、定位、旋转、缩放
 *   2. 验证 Actor 生命周期：创建 → 加入世界 → 移动 → 销毁（从场景正确移除）
 *   3. 验证 Actor 的 Owner 颜色系统（Player affiliation visual coding）
 *   4. 验证 Disposal 模式：子节点在 dispose 前正确分离
 *
 * OpenRA 对照: Actor.ts (GameActor extends TransformNode)
 * 本测试使用纯 Babylon.js 原语模拟 GameActor 行为模式，独立运行。
 */

import { Engine } from '@babylonjs/core'
import { Scene } from '@babylonjs/core'
import { ArcRotateCamera } from '@babylonjs/core'
import { HemisphericLight } from '@babylonjs/core'
import { Vector3 } from '@babylonjs/core'
import { Color3, Color4 } from '@babylonjs/core'
import { MeshBuilder } from '@babylonjs/core'
import { TransformNode } from '@babylonjs/core'
import type { Mesh } from '@babylonjs/core'
import { StandardMaterial } from '@babylonjs/core'
import { DynamicTexture } from '@babylonjs/core'

// ---------------------------------------------------------------------------
// 类型：测试用 Actor 条目
// ---------------------------------------------------------------------------

interface TestActorEntry {
  /** 对应 GameActor (TransformNode) */
  node: TransformNode
  /** "Trait" 渲染的 Mesh（模拟 Render trait 的输出） */
  mesh: Mesh
  /** Owner 颜色索引 (0=Neutral, 1=PlayerA, 2=PlayerB) */
  ownerIndex: number
  /** Actor 名称 */
  name: string
  /** 创建时的 tick 序号 */
  spawnTick: number
}

// ---------------------------------------------------------------------------
// Owner 颜色 (对应 OpenRA Player.color ARGB)
// ---------------------------------------------------------------------------

const OWNER_COLORS: readonly Color3[] = [
  new Color3(0.55, 0.55, 0.55), // Neutral: gray (#8C8C8C)
  new Color3(0.20, 0.60, 0.95), // PlayerA: blue (#3399F2)
  new Color3(0.95, 0.33, 0.20), // PlayerB: red (#F25433)
]

// ---------------------------------------------------------------------------
// 辅助: 创建 2D 精灵纹理（用作 Actor 的 body mesh 材质）
// ---------------------------------------------------------------------------

function createActorTexture(color: Color3, scene: Scene, label: string): DynamicTexture {
  const size = 128
  const tex = new DynamicTexture(`tex_${label}`, { width: size, height: size }, scene, false)
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D
  const half = size / 2
  const r = Math.round(color.r * 255)
  const g = Math.round(color.g * 255)
  const b = Math.round(color.b * 255)

  // 圆角矩形 body
  ctx.fillStyle = `rgb(${r},${g},${b})`
  ctx.beginPath()
  ctx.roundRect(half * 0.12, half * 0.12, half * 1.76, half * 1.76, half * 0.18)
  ctx.fill()

  // 白色边框
  ctx.strokeStyle = 'rgba(255,255,255,0.65)'
  ctx.lineWidth = 2.5
  ctx.stroke()

  // 标签文字
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 22px "Segoe UI", system-ui'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, half, half)

  // 小箭头（指示朝向）
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.beginPath()
  ctx.moveTo(half, half * 0.15)
  ctx.lineTo(half - half * 0.12, half * 0.3)
  ctx.lineTo(half + half * 0.12, half * 0.3)
  ctx.closePath()
  ctx.fill()

  tex.update(true)
  tex.hasAlpha = true
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
      antialias: true,
    })
  } catch {
    document.getElementById('gpu-error')!.style.display = 'flex'
    infoEngine.textContent = 'UNAVAILABLE'
    return
  }
  infoEngine.textContent = `Babylon.js v${Engine.Version} / WebGL ${engine.webGLVersion}.0`

  // ---- 场景创建 ----
  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.08, 0.10, 0.14, 1)

  // ---- 摄像机 (RTS 俯视角) ----
  const camera = new ArcRotateCamera(
    'cam',
    -Math.PI / 4,
    Math.PI / 3.5,
    30,
    new Vector3(0, 0, 0),
    scene,
  )
  camera.lowerRadiusLimit = 5
  camera.upperRadiusLimit = 60
  camera.panningSensibility = 500
  camera.attachControl(canvas, true)

  // ---- 光照 ----
  const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
  light.intensity = 0.85

  // ---- 地面参考平面 ----
  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.emissiveColor = new Color3(0.10, 0.13, 0.18)
  groundMat.disableLighting = true
  const ground = MeshBuilder.CreateGround('ground', { width: 40, height: 40 }, scene)
  ground.material = groundMat
  ground.position.y = -0.01

  // ---- 网格线 (XZ 平面, 每 5 单位) ----
  for (let i = -20; i <= 20; i += 5) {
    const lineX = MeshBuilder.CreateLines(`gridX_${i}`, {
      points: [new Vector3(i, 0.005, -20), new Vector3(i, 0.005, 20)],
    }, scene)
    lineX.color = new Color3(0.15, 0.2, 0.3)
    const lineZ = MeshBuilder.CreateLines(`gridZ_${i}`, {
      points: [new Vector3(-20, 0.005, i), new Vector3(20, 0.005, i)],
    }, scene)
    lineZ.color = new Color3(0.15, 0.2, 0.3)
  }

  // ---- Actor 管理 ----
  const testActors: TestActorEntry[] = []
  let totalCreated = 0
  let tickNumber = 0

  const statCount = document.getElementById('stat-count')!
  const statTotal = document.getElementById('stat-total')!

  function updateStats(): void {
    statCount.textContent = String(testActors.length)
    statTotal.textContent = String(totalCreated)
  }

  /**
   * 创建一个可视化 Actor。
   * 模拟 GameActor 的两阶段初始化模式：
   * 1. Constructor: 创建 TransformNode + 分配 actorId
   * 2. Initialize: 附加 trait 渲染 Mesh
   */
  function spawnActor(x: number, z: number, ownerIndex: number): TestActorEntry {
    const name = `A${totalCreated + 1}`
    totalCreated++

    // Phase 1: 创建 Actor (对应 new GameActor(options))
    const node = new TransformNode(`actor_${name}`, scene)
    node.position.set(x, 0.05, z)

    // Phase 2: 附加 "trait" Mesh (对应 ITrait.render() 输出)
    const color = OWNER_COLORS[ownerIndex]
    const tex = createActorTexture(color, scene, name)
    const mat = new StandardMaterial(`mat_${name}`, scene)
    mat.diffuseTexture = tex
    mat.emissiveTexture = tex
    mat.emissiveColor = Color3.White()
    mat.specularColor.set(0, 0, 0)
    mat.backFaceCulling = false
    mat.disableLighting = true

    const size = 1.5 + Math.random() * 1.5
    const mesh = MeshBuilder.CreateGround(`body_${name}`, { width: size, height: size }, scene)
    mesh.material = mat
    mesh.parent = node // 子 mesh 挂载到 Actor TransformNode
    mesh.position = Vector3.Zero()

    const entry: TestActorEntry = { node, mesh, ownerIndex, name, spawnTick: tickNumber }
    testActors.push(entry)
    updateStats()
    return entry
  }

  /**
   * 销毁 Actor。
   * 模拟 GameActor.dispose() 模式：
   * 1. 分离子 mesh（防止 cascade disposal）
   * 2. 调用 node.dispose()
   * 3. Mesh 独立 dispose
   */
  function disposeActor(entry: TestActorEntry): void {
    const idx = testActors.indexOf(entry)
    if (idx !== -1) testActors.splice(idx, 1)

    // Step 1: 分离子 mesh（对应 GameActor 的 doNotRecurse 模式）
    entry.mesh.parent = null

    // Step 2: dispose TransformNode (对应 actor.dispose())
    entry.node.dispose(true, false) // doNotRecurse

    // Step 3: dispose mesh (对应 trait GPU 资源清理)
    entry.mesh.dispose()

    updateStats()
  }

  // ---- 批量生成 ----
  function spawnRandom(count: number): void {
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 30
      const z = (Math.random() - 0.5) * 30
      const owner = Math.floor(Math.random() * 3)
      spawnActor(x, z, owner)
    }
  }

  // ---- 初始生成 8 个 Actor ----
  spawnRandom(8)

  // ---- UI 绑定 ----
  document.getElementById('btn-spawn')!.addEventListener('click', () => spawnRandom(5))

  document.getElementById('btn-dispose-all')!.addEventListener('click', () => {
    while (testActors.length > 0) {
      disposeActor(testActors[testActors.length - 1])
    }
  })

  document.getElementById('btn-move-random')!.addEventListener('click', () => {
    for (const entry of testActors) {
      entry.node.position.x = (Math.random() - 0.5) * 30
      entry.node.position.z = (Math.random() - 0.5) * 30
    }
  })

  let scaleIndex = 0
  const scalePresets = [0.5, 1.0, 2.0, 3.0]
  document.getElementById('btn-scale')!.addEventListener('click', () => {
    scaleIndex = (scaleIndex + 1) % scalePresets.length
    const s = scalePresets[scaleIndex]
    for (const entry of testActors) {
      entry.node.scaling.set(s, s, s)
    }
    document.getElementById('btn-scale')!.textContent = `Cycle Scale (${s}x)`
  })

  document.getElementById('btn-owner-toggle')!.addEventListener('click', () => {
    for (const entry of testActors) {
      entry.ownerIndex = (entry.ownerIndex + 1) % 3
      const newColor = OWNER_COLORS[entry.ownerIndex]
      // 替换材质纹理模拟 Owner 颜色变化
      const oldTex = (entry.mesh.material as StandardMaterial).diffuseTexture as DynamicTexture
      const newTex = createActorTexture(newColor, scene, entry.name)
      const mat = entry.mesh.material as StandardMaterial
      mat.diffuseTexture = newTex
      mat.emissiveTexture = newTex
      oldTex?.dispose()
    }
  })

  const chkAnimate = document.getElementById('chk-animate') as HTMLInputElement

  // ---- 渲染循环 ----
  let fpsFrames = 0
  let fpsAccum = 0
  let lastFpsUpdate = performance.now()
  let fpsDisplay = 0
  let firstFrame = true

  engine.runRenderLoop(() => {
    try {
      if (firstFrame) {
        lastFpsUpdate = performance.now()
        firstFrame = false
      }

      // 模拟 tick: 驱动 actor 行为
      tickNumber++

      // 动画旋转 (模拟 IFacing.orientation 驱动 TransformNode.rotationY)
      if (chkAnimate.checked) {
        const turnRate = 0.008 // ~0.5 rad/s
        for (const entry of testActors) {
          entry.node.rotation.y += turnRate
        }
      }

      scene.render()

      // FPS 计算
      const now = performance.now()
      fpsFrames++
      fpsAccum += now - lastFpsUpdate
      lastFpsUpdate = now

      if (fpsAccum >= 250) {
        fpsDisplay = Math.round((fpsFrames / fpsAccum) * 1000)
        fpsFrames = 0
        fpsAccum = 0
        infoFps.textContent = String(fpsDisplay)
        infoTime.textContent = new Date().toISOString()
      }
    } catch (loopErr) {
      console.error('[render-loop] error:', loopErr)
    }
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
