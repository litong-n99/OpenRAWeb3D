/**
 * main.ts -- Player 玩家颜色与外交关系人工验收测试
 *
 * 测试目标:
 *   1. 验证 Player 颜色 ARGB 值在 3D 渲染中的正确显示
 *   2. 验证 PlayerRelationshipColor 的四种关系色映射 (Self/Ally/Neutral/Enemy)
 *   3. 验证外交关系矩阵 (Ally/Neutral/Enemy) 的颜色一致性
 *
 * OpenRA 对照:
 * - Player.color (ARGB, int)
 * - PlayerRelationshipColor(viewer, target) → 4 种 stance colors
 * - RelationshipWith(other) → Ally / Neutral / Enemy
 *
 * 关系色常量 (OpenRA ChromeMetrics 默认值):
 *   Self:    0xFF00FF00 (绿色)
 *   Ally:    0xFFFFFF00 (黄色)
 *   Neutral: 0xFFFFFFFF (白色)
 *   Enemy:   0xFFFF0000 (红色)
 */

import { Engine } from '@babylonjs/core'
import { Scene } from '@babylonjs/core'
import { ArcRotateCamera } from '@babylonjs/core'
import { HemisphericLight } from '@babylonjs/core'
import { Vector3 } from '@babylonjs/core'
import { Color3, Color4 } from '@babylonjs/core'
import { MeshBuilder } from '@babylonjs/core'
import type { Mesh } from '@babylonjs/core'
import { StandardMaterial } from '@babylonjs/core'
import { DynamicTexture } from '@babylonjs/core'
import { TransformNode } from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Player 数据（模拟 OpenRA Player 类）
// ---------------------------------------------------------------------------

/** 外交关系常量 (对应 PlayerRelationship) */
const Relation = {
  Self: 0,
  Ally: 1,
  Neutral: 2,
  Enemy: 3,
} as const

type Relation = (typeof Relation)[keyof typeof Relation]

/** Player 原始色 (ARGB, 对应 Player.color) */
interface PlayerConfig {
  name: string
  argb: number       // 原始颜色 ARGB
  faction: string
}

/** 关系色映射 (对应 OpenRA ChromeMetrics + PlayerRelationshipColor) */
const STANCE_COLORS: Record<number, number> = {
  [Relation.Self]:    0xFF00FF00, // 绿
  [Relation.Ally]:    0xFFFFFF00, // 黄
  [Relation.Neutral]: 0xFFFFFFFF, // 白
  [Relation.Enemy]:   0xFFFF0000, // 红
}

const STANCE_NAMES: Record<number, string> = {
  [Relation.Self]:    'Self',
  [Relation.Ally]:    'Ally',
  [Relation.Neutral]: 'Neutral',
  [Relation.Enemy]:   'Enemy',
}

const STANCE_CSS_CLASS: Record<number, string> = {
  [Relation.Self]:    'self',
  [Relation.Ally]:    'ally',
  [Relation.Neutral]: 'neutral',
  [Relation.Enemy]:   'enemy',
}

// ---------------------------------------------------------------------------
// 预设 Player 列表
// ---------------------------------------------------------------------------

const PLAYERS: PlayerConfig[] = [
  { name: 'Player A',  argb: 0xFF3399F2, faction: 'Allies' },
  { name: 'Player B',  argb: 0xFFF25433, faction: 'Soviet' },
  { name: 'Player C',  argb: 0xFF33CC66, faction: 'Allies' },
  { name: 'Player D',  argb: 0xFFFF9933, faction: 'Soviet' },
  { name: 'Neutral',   argb: 0xFFB0B0B0, faction: 'Neutral' },
]

// ---------------------------------------------------------------------------
// 初始外交关系矩阵 (row 对 col 的关系)
//   [Row][Col] = Relation of Row towards Col
// ---------------------------------------------------------------------------
let relations: number[][] = [
  //           A     B     C     D     N
  /* A */ [ 0, 3, 1, 2, 2 ],
  /* B */ [ 3, 0, 2, 1, 2 ],
  /* C */ [ 1, 2, 0, 3, 2 ],
  /* D */ [ 2, 1, 3, 0, 2 ],
  /* N */ [ 2, 2, 2, 2, 0 ],
]

// ---------------------------------------------------------------------------
// 3D 场景中的 Player 可视化节点
// ---------------------------------------------------------------------------

interface PlayerVisual {
  node: TransformNode
  mesh: Mesh
  name: string
  argb: number
  row: number // grid row
}

// ---------------------------------------------------------------------------
// ARGB 转换为 Babylon Color3
// ---------------------------------------------------------------------------

function argbToColor3(argb: number): Color3 {
  const r = ((argb >> 16) & 0xFF) / 255
  const g = ((argb >> 8) & 0xFF) / 255
  const b = (argb & 0xFF) / 255
  return new Color3(r, g, b)
}

// ---------------------------------------------------------------------------
// 辅助: 创建单位纹理
// ---------------------------------------------------------------------------

function createUnitTexture(color: Color3, scene: Scene, label: string): DynamicTexture {
  const size = 128
  const tex = new DynamicTexture(`tex_${label}`, { width: size, height: size }, scene, false)
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D
  const half = size / 2
  const r = Math.round(color.r * 255)
  const g = Math.round(color.g * 255)
  const b = Math.round(color.b * 255)

  // 圆形
  ctx.fillStyle = `rgb(${r},${g},${b})`
  ctx.beginPath()
  ctx.arc(half, half, half * 0.4, 0, Math.PI * 2)
  ctx.fill()

  // 外圈
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 2
  ctx.stroke()

  // 标签
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 20px "Segoe UI", system-ui'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, half, half)

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

  // ---- Babylon.js ----
  const sandboxEl = document.getElementById('canvas-panel')!
  const canvas = document.createElement('canvas')
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.width = Math.max(sandboxEl.getBoundingClientRect().width || 600, 1)
  canvas.height = Math.max(sandboxEl.getBoundingClientRect().height || 500, 1)
  sandboxEl.appendChild(canvas)

  let engine: Engine
  try {
    engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false, antialias: true })
  } catch {
    document.getElementById('gpu-error')!.style.display = 'flex'
    infoEngine.textContent = 'UNAVAILABLE'
    return
  }
  infoEngine.textContent = `Babylon.js v${Engine.Version} / WebGL ${engine.webGLVersion}.0`

  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.08, 0.10, 0.14, 1)

  const camera = new ArcRotateCamera(
    'cam', -Math.PI / 4, Math.PI / 3, 20,
    new Vector3(0, 0, 0), scene,
  )
  camera.lowerRadiusLimit = 5
  camera.upperRadiusLimit = 40
  camera.panningSensibility = 500
  camera.attachControl(canvas, true)

  const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
  light.intensity = 0.9

  // 地面
  const groundMat = new StandardMaterial('ground', scene)
  groundMat.emissiveColor = new Color3(0.10, 0.13, 0.18)
  groundMat.disableLighting = true
  const ground = MeshBuilder.CreateGround('ground', { width: 30, height: 30 }, scene)
  ground.material = groundMat
  ground.position.y = -0.01

  // ---- 状态 ----
  const playerVisuals: PlayerVisual[] = []
  let currentViewer = 0
  let useStanceColors = true

  // ---- 渲染 Player 单位 ----
  function renderPlayerUnits(): void {
    // 清空
    for (const pv of playerVisuals) {
      pv.mesh.dispose()
      pv.node.dispose()
    }
    playerVisuals.length = 0

    const numPlayers = PLAYERS.length
    const radius = 6
    const angleStep = (Math.PI * 2) / numPlayers

    for (let i = 0; i < numPlayers; i++) {
      const angle = angleStep * i - Math.PI / 2
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius

      const rel = useStanceColors
        ? relations[currentViewer][i]
        : Relation.Neutral // 不使用关系色 → 全部原始色
      const displayArgb = useStanceColors
        ? STANCE_COLORS[rel]
        : PLAYERS[i].argb

      const color = argbToColor3(displayArgb)
      const label = `${PLAYERS[i].name[0]}`
      const tex = createUnitTexture(color, scene, label)
      const mat = new StandardMaterial(`mat_${i}`, scene)
      mat.diffuseTexture = tex
      mat.emissiveTexture = tex
      mat.emissiveColor = Color3.White()
      mat.specularColor.set(0, 0, 0)
      mat.backFaceCulling = false
      mat.disableLighting = true

      const node = new TransformNode(`player_${i}`, scene)
      node.position.set(x, 0.05, z)

      const size = 2.0
      const mesh = MeshBuilder.CreateGround(`unit_${i}`, { width: size, height: size }, scene)
      mesh.material = mat
      mesh.parent = node
      mesh.position = Vector3.Zero()

      // 关系指示箭头线（从观察者指向目标）
      if (i !== currentViewer && useStanceColors) {
        const lineColor = argbToColor3(STANCE_COLORS[rel])
        const originX = Math.cos(angleStep * currentViewer - Math.PI / 2) * radius
        const originZ = Math.sin(angleStep * currentViewer - Math.PI / 2) * radius
        const midX = (originX + x) / 2
        const midZ = (originZ + z) / 2
        const line = MeshBuilder.CreateLines(`rel_${i}`, {
          points: [
            new Vector3(originX, 0.5, originZ),
            new Vector3(midX, 0.8, midZ),
            new Vector3(x, 0.5, z),
          ],
        }, scene)
        line.color = lineColor
        ;(line as any).__temp = true
      }

      playerVisuals.push({ node, mesh, name: PLAYERS[i].name, argb: displayArgb, row: i })
    }
  }

  // ---- 颜色面板 ----
  function renderColorPanel(): void {
    const container = document.getElementById('color-rows')!
    container.innerHTML = ''

    for (let i = 0; i < PLAYERS.length; i++) {
      const p = PLAYERS[i]
      const rel = relations[currentViewer][i]
      const displayArgb = useStanceColors ? STANCE_COLORS[rel] : p.argb
      const hex = '#' + (displayArgb & 0xFFFFFF).toString(16).padStart(6, '0').toUpperCase()
      const stanceClass = useStanceColors ? STANCE_CSS_CLASS[rel] : 'neutral'

      const row = document.createElement('div')
      row.className = `color-row ${stanceClass}`

      const swatch = document.createElement('div')
      swatch.className = 'swatch'
      swatch.style.backgroundColor = hex

      const meta = document.createElement('div')
      meta.className = 'color-meta'
      meta.innerHTML = `
        <div class="name">${p.name} (${p.faction})</div>
        <div class="argb">原始: 0x${p.argb.toString(16).padStart(8, '0').toUpperCase()}</div>
        <div class="argb">显示: 0x${displayArgb.toString(16).padStart(8, '0').toUpperCase()} → ${hex}</div>
        <div class="desc">${useStanceColors ? `关系: ${STANCE_NAMES[rel]} (${STANCE_NAMES[rel]}色)` : '关系色禁用 — 使用原始色'}</div>
      `

      row.appendChild(swatch)
      row.appendChild(meta)
      container.appendChild(row)
    }
  }

  // ---- 关系矩阵 ----
  function renderRelationGrid(): void {
    const grid = document.getElementById('rel-grid')!
    grid.innerHTML = ''

    // Header row
    grid.appendChild(cell('', 'header'))
    for (const p of PLAYERS) {
      grid.appendChild(cell(p.name[0], 'header'))
    }

    for (let r = 0; r < PLAYERS.length; r++) {
      grid.appendChild(cell(PLAYERS[r].name[0], 'row-hdr'))
      for (let c = 0; c < PLAYERS.length; c++) {
        const rel = relations[r][c]
        const cssClass = `rel-${STANCE_NAMES[rel].toLowerCase()}`
        const marker = r === currentViewer && c !== currentViewer ? '▶ ' : ''
        grid.appendChild(cell(marker + STANCE_NAMES[rel], cssClass))
      }
    }
  }

  function cell(text: string, className: string): HTMLDivElement {
    const d = document.createElement('div')
    d.className = `cell ${className}`
    d.textContent = text
    return d
  }

  // ---- 完整刷新 ----
  function refreshAll(): void {
    renderPlayerUnits()
    renderColorPanel()
    renderRelationGrid()
    document.getElementById('viewer-label')!.textContent = PLAYERS[currentViewer].name
  }

  // ---- UI 绑定 ----
  document.getElementById('btn-cycle-viewer')!.addEventListener('click', () => {
    currentViewer = (currentViewer + 1) % PLAYERS.length
    refreshAll()
  })

  document.getElementById('chk-stance-colors')!.addEventListener('input', (e) => {
    useStanceColors = (e.target as HTMLInputElement).checked
    refreshAll()
  })

  document.getElementById('btn-random-relations')!.addEventListener('click', () => {
    const n = PLAYERS.length
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (r === c) {
          relations[r][c] = Relation.Self
        } else {
          const roll = Math.random()
          if (roll < 0.33) relations[r][c] = Relation.Ally
          else if (roll < 0.66) relations[r][c] = Relation.Neutral
          else relations[r][c] = Relation.Enemy
        }
      }
    }
    refreshAll()
  })

  document.getElementById('btn-reset')!.addEventListener('click', () => {
    relations = [
      [ Relation.Self,  Relation.Enemy,  Relation.Ally,   Relation.Neutral, Relation.Neutral ],
      [ Relation.Enemy,  Relation.Self,   Relation.Neutral, Relation.Ally,   Relation.Neutral ],
      [ Relation.Ally,   Relation.Neutral, Relation.Self,   Relation.Enemy,  Relation.Neutral ],
      [ Relation.Neutral, Relation.Ally,   Relation.Enemy,  Relation.Self,   Relation.Neutral ],
      [ Relation.Neutral, Relation.Neutral, Relation.Neutral, Relation.Neutral, Relation.Self ],
    ]
    currentViewer = 0
    useStanceColors = true
    ;(document.getElementById('chk-stance-colors') as HTMLInputElement).checked = true
    refreshAll()
  })

  // ---- 渲染循环 ----
  let fpsFrames = 0
  let fpsAccum = 0
  let lastFpsUpdate = performance.now()
  let firstFrame = true

  engine.runRenderLoop(() => {
    try {
      if (firstFrame) { lastFpsUpdate = performance.now(); firstFrame = false }

      // 单位轻微旋转
      for (const pv of playerVisuals) {
        pv.node.rotation.y += 0.005
      }

      scene.render()

      const now = performance.now()
      fpsFrames++
      fpsAccum += now - lastFpsUpdate
      lastFpsUpdate = now
      if (fpsAccum >= 250) {
        infoFps.textContent = String(Math.round((fpsFrames / fpsAccum) * 1000))
        fpsFrames = 0; fpsAccum = 0
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

  // 初始渲染
  refreshAll()
}

main().catch((err: unknown) => {
  console.error('[fatal] main() failed:', err)
  const errorEl = document.getElementById('gpu-error')!
  errorEl.style.display = 'flex'
  errorEl.textContent = `初始化失败: ${err instanceof Error ? err.message : String(err)}`
})
