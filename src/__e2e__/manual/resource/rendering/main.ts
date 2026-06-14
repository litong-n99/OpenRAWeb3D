/**
 * main.ts — ResourceRenderer 资源精灵密度与变体渲染 人工验收测试
 *
 * 测试目标:
 *   1. 验证资源精灵出现在正确的地形 cell 位置
 *   2. 验证精灵帧响应密度变化（density → frame lerp）
 *   3. 验证变体渲染（同一资源类型的不同 sequence variant）
 *   4. 验证多种资源类型（Tiberium, Ore, Spice, Gems）同时渲染
 *
 * OpenRA 对照: ResourceRenderer.ts
 *   - lerpFrame(a, b, mu, muMax) → 密度 → 帧索引线性插值
 *   - cellVariantIndex(cell, numVariants) → (X*31+Y*17)&0x7fffffff % numVariants
 *   - ResourceRendererInfo.resourceTypes → 每类型配置 image/sequences/palette/name
 *
 * 本测试页使用 Babylon.js Solid Particle System (SPS) 模拟地形资源 cell。
 * 每个粒子代表一个 cell，其颜色和缩放模拟资源精灵的帧/变体行为。
 * 密度驱动粒子高度（模拟精灵帧变化），变体驱动颜色偏移。
 */

import { Engine } from '@babylonjs/core'
import { Scene } from '@babylonjs/core'
import { ArcRotateCamera } from '@babylonjs/core'
import { HemisphericLight } from '@babylonjs/core'
import { DirectionalLight } from '@babylonjs/core'
import { Vector3, Color3, Color4 } from '@babylonjs/core'
import { MeshBuilder } from '@babylonjs/core'
import { StandardMaterial } from '@babylonjs/core'
import { SolidParticleSystem } from '@babylonjs/core'

// ---------------------------------------------------------------------------
// 资源类型定义（模拟 ResourceRendererInfo.resourceTypes）
// ---------------------------------------------------------------------------

/** 资源类型配置 — 对应 ResourceRendererTypeConfig */
interface ResourceTypeConfig {
  /** 资源类型名 */
  name: string
  /** 基础颜色 RGB */
  baseColor: [number, number, number]
  /** 密度最高时的颜色 */
  fullColor: [number, number, number]
  /** 该类型使用的 sequence 数量（变体数） */
  numVariants: number
  /** 是否可见 */
  visible: boolean
}

/** 资源类型定义 — 对应 OpenRA C&C mod 中的资源类型 */
const RESOURCE_TYPES: Record<string, ResourceTypeConfig> = {
  Tiberium: {
    name: 'Tiberium',
    baseColor: [0.05, 0.25, 0.08],     // 稀疏时深绿
    fullColor: [0.00, 0.80, 0.27],      // #00CC44 — 浓密时亮绿
    numVariants: 3,
    visible: true,
  },
  Ore: {
    name: 'Ore',
    baseColor: [0.20, 0.12, 0.02],      // 稀疏时深棕金
    fullColor: [0.85, 0.65, 0.13],      // #DAA520 — Goldenrod
    numVariants: 4,
    visible: true,
  },
  Spice: {
    name: 'Spice',
    baseColor: [0.18, 0.08, 0.01],      // 稀疏时深褐
    fullColor: [0.80, 0.33, 0.00],      // #CC5500 — 橙红
    numVariants: 3,
    visible: true,
  },
  Gems: {
    name: 'Gems',
    baseColor: [0.15, 0.02, 0.15],      // 稀疏时深紫
    fullColor: [0.80, 0.27, 0.80],      // #CC44CC — 紫红
    numVariants: 4,
    visible: true,
  },
}

// ---------------------------------------------------------------------------
// 核心算法：直接从 ResourceRenderer.ts 移植
// OpenRA 对照: ResourceRenderer.ts lines 370-391
// ---------------------------------------------------------------------------

/** 密度 → 帧索引线性插值
 *
 * OpenRA 对照: lerpFrame(a, b, mu, muMax) — line 370
 *
 * 密度 0=帧 0（最小帧），密度=maxDensity=帧 sequence.length-1（最大帧）
 */
function lerpFrame(a: number, b: number, mu: number, muMax: number): number {
  if (muMax <= 0) return a
  const t = mu / muMax
  return Math.round(a + (b - a) * t)
}

/** 基于 CPos hash 的确定性变体选择
 *
 * OpenRA 对照: cellVariantIndex(cell, numVariants) — line 386
 *
 * hash = (X * 31 + Y * 17) & 0x7fffffff
 */
function cellVariantIndex(x: number, y: number, numVariants: number): number {
  if (numVariants <= 1) return 0
  const hash = (x * 31 + y * 17) & 0x7fffffff
  return Math.abs(hash) % numVariants
}

/** 变体偏移色相 — 根据变体索引产生不同的颜色偏移 */
function variantColorShift(
  baseColor: [number, number, number],
  variantIdx: number,
  numVariants: number,
): [number, number, number] {
  if (numVariants <= 1) return baseColor
  // 色调偏移：通过调整 RGB 分量比例模拟变体差异
  const [r, g, b] = baseColor
  const factor = 1.0 + (variantIdx / numVariants * 0.3) - 0.15
  return [
    Math.min(1, Math.max(0, r * factor)),
    Math.min(1, Math.max(0, g * (factor + 0.05 * (variantIdx % 2 === 0 ? 1 : -1)))),
    Math.min(1, Math.max(0, b * factor)),
  ]
}

// ---------------------------------------------------------------------------
// 地图数据
// ---------------------------------------------------------------------------

const MAP_WIDTH = 18
const MAP_HEIGHT = 12
const TOTAL_CELLS = MAP_WIDTH * MAP_HEIGHT

interface CellData {
  /** 资源类型（空字符串=无资源） */
  type: string
  /** 密度（0=无资源） */
  density: number
  /** 选择的变体索引 */
  variantIdx: number
}

// ---------------------------------------------------------------------------
// 密度生成模式
// ---------------------------------------------------------------------------

type DensityPattern = 'gradient' | 'stripes' | 'random' | 'hotspot'

function generateCellData(
  pattern: DensityPattern,
  maxDensity: number,
  numVariants: number,
  visibleTypes: Set<string>,
): CellData[] {
  const cells: CellData[] = new Array(TOTAL_CELLS)

  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const idx = y * MAP_WIDTH + x

      // 选择资源类型 — 按列/行交替
      const typeIdx = ((x + y * 3) % visibleTypes.size)
      const typeKeys = Array.from(visibleTypes)
      const type = typeKeys[typeIdx]!

      // 确定密度
      let density: number
      switch (pattern) {
        case 'gradient':
          // 左低右高
          density = Math.round(1 + (x / (MAP_WIDTH - 1)) * (maxDensity - 1))
          break
        case 'stripes':
          // 密度逐行递增
          density = Math.round(2 + (y / (MAP_HEIGHT - 1)) * (maxDensity - 2))
          density = Math.max(1, Math.min(maxDensity, density))
          break
        case 'random':
          density = Math.floor(Math.random() * maxDensity) + 1
          break
        case 'hotspot':
          // 中央高密度，边缘低密度
          const dx = x - MAP_WIDTH / 2
          const dy = y - MAP_HEIGHT / 2
          const dist = Math.sqrt(dx * dx + dy * dy)
          const maxDist = Math.sqrt((MAP_WIDTH / 2) ** 2 + (MAP_HEIGHT / 2) ** 2)
          density = Math.round(maxDensity * (1 - dist / maxDist))
          density = Math.max(1, Math.min(maxDensity, density))
          break
        default:
          density = 5
      }

      // 密度微调：边界 cell 密度降低（模拟矿脉边缘）
      const edgeDist = Math.min(x, MAP_WIDTH - 1 - x, y, MAP_HEIGHT - 1 - y)
      if (edgeDist === 0) {
        density = Math.max(1, Math.floor(density * 0.3))
      } else if (edgeDist === 1) {
        density = Math.max(1, Math.floor(density * 0.6))
      }

      const variantIdx = cellVariantIndex(x, y, numVariants)

      cells[idx] = { type, density, variantIdx }
    }
  }

  return cells
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

  // ---- 摄像机（俯瞰视角） ----
  const camera = new ArcRotateCamera(
    'cam',
    -Math.PI / 2,       // alpha: 从+Y看
    Math.PI / 4,        // beta: 45 度俯角
    20,                  // radius
    new Vector3(0, 0, 0),
    scene,
  )
  camera.lowerRadiusLimit = 6
  camera.upperRadiusLimit = 50
  camera.lowerBetaLimit = 0.1
  camera.upperBetaLimit = Math.PI / 2.2
  camera.panningSensibility = 800
  camera.attachControl(canvas, true)

  // ---- 光照 ----
  const hemiLight = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)
  hemiLight.intensity = 0.5
  const dirLight = new DirectionalLight('dir', new Vector3(0.5, -0.8, 0.3), scene)
  dirLight.intensity = 0.6

  // ---- 地形底板 ----
  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.diffuseColor = new Color3(0.25, 0.20, 0.15)
  groundMat.specularColor.set(0, 0, 0)
  const ground = MeshBuilder.CreateGround('ground', {
    width: MAP_WIDTH * 1.05 + 0.2,
    height: MAP_HEIGHT * 1.05 + 0.2,
  }, scene)
  ground.position.set((MAP_WIDTH - 1) / 2 * 1.05, -0.15, (MAP_HEIGHT - 1) / 2 * 1.05)
  ground.material = groundMat
  ground.receiveShadows = false

  // ---- 状态变量 ----
  let maxDensity = 10
  let numVariants = 3
  let densityPattern: DensityPattern = 'stripes'
  let visibleTypes = new Set<string>(['Tiberium', 'Ore', 'Spice', 'Gems'])
  let cellData = generateCellData(densityPattern, maxDensity, numVariants, visibleTypes)
  let showVariantBorders = false

  // SPS 引用
  let sps: SolidParticleSystem | null = null

  // ---- UI 引用 ----
  const showTib = document.getElementById('show-tiberium') as HTMLInputElement
  const showOre = document.getElementById('show-ore') as HTMLInputElement
  const showSpice = document.getElementById('show-spice') as HTMLInputElement
  const showGems = document.getElementById('show-gems') as HTMLInputElement
  const btnApplyFilter = document.getElementById('btn-apply-filter') as HTMLButtonElement
  const densityPatternSel = document.getElementById('density-pattern') as HTMLSelectElement
  const maxDensitySel = document.getElementById('max-density') as HTMLSelectElement
  const btnRegen = document.getElementById('btn-regenerate') as HTMLButtonElement
  const variantCountSel = document.getElementById('variant-count') as HTMLSelectElement
  const btnHighlightVariants = document.getElementById('btn-highlight-variants') as HTMLButtonElement

  const statResourceCells = document.getElementById('stat-resource-cells')!
  const statEmptyCells = document.getElementById('stat-empty-cells')!
  const statAvgDensity = document.getElementById('stat-avg-density')!
  const statActiveTypes = document.getElementById('stat-active-types')!
  const statVariantCount = document.getElementById('stat-variant-count')!

  // ---- 更新统计 ----
  function updateStats(): void {
    let resourceCells = 0
    let emptyCells = 0
    let totalDensity = 0
    for (const cell of cellData) {
      if (cell.density > 0) {
        resourceCells++
        totalDensity += cell.density
      } else {
        emptyCells++
      }
    }
    statResourceCells.textContent = String(resourceCells)
    statEmptyCells.textContent = String(emptyCells)
    statAvgDensity.textContent = resourceCells > 0
      ? (totalDensity / resourceCells).toFixed(2)
      : '0'
    statActiveTypes.textContent = String(visibleTypes.size)
    statVariantCount.textContent = String(numVariants * visibleTypes.size)
  }

  // ---- 计算资源颜色 ----
  function getCellColor(cell: CellData): [number, number, number, number] {
    if (cell.density <= 0 || !visibleTypes.has(cell.type)) {
      return [0.15, 0.13, 0.10, 0.3] // 空 cell 淡灰色
    }

    const config = RESOURCE_TYPES[cell.type]
    if (!config) return [0.15, 0.13, 0.10, 0.5]

    // 密度 → 帧索引（模拟 lerpFrame）
    const frameCount = 8 // 每 sequence 8 帧
    const frame = lerpFrame(0, frameCount - 1, cell.density, maxDensity)

    // 帧索引 → 颜色混合（低帧=深/小，高帧=亮/密）
    const t = frame / (frameCount - 1)
    const base = config.baseColor
    const full = config.fullColor
    const r = base[0] + (full[0] - base[0]) * t
    const g = base[1] + (full[1] - base[1]) * t
    const b = base[2] + (full[2] - base[2]) * t

    // 变体颜色偏移
    const [vr, vg, vb] = variantColorShift(
      [r, g, b],
      cell.variantIdx,
      numVariants,
    )

    return [vr, vg, vb, 0.85 + frame / frameCount * 0.15]
  }

  // ---- 获取粒子缩放（密度越高 cell 看起来越"饱满"） ----
  function getCellScale(cell: CellData): number {
    if (cell.density <= 0) return 0.15
    const frameCount = 8
    const frame = lerpFrame(0, frameCount - 1, cell.density, maxDensity)
    const t = frame / (frameCount - 1)
    return 0.30 + t * 0.65 // 30%~95% of cell size
  }

  // ---- 构建/重建 SPS ----
  function buildSPS(): void {
    if (sps) {
      sps.dispose()
      sps = null
    }

    const cellWorldSize = 1.05
    const startX = 0
    const startZ = 0

    // 创建样板 mesh
    const shapeMesh = MeshBuilder.CreatePlane('shape', { width: 1, height: 1 }, scene)
    shapeMesh.isVisible = false

    sps = new SolidParticleSystem('resourceSPS', scene, { updatable: true })
    sps.addShape(shapeMesh, TOTAL_CELLS)
    shapeMesh.dispose()

    const spsMesh = sps.buildMesh()
    const mat = new StandardMaterial('resourceMat', scene)
    mat.emissiveColor = new Color3(1, 1, 1)
    mat.specularColor.set(0, 0, 0)
    mat.disableLighting = true
    mat.backFaceCulling = false
    spsMesh.material = mat

    // 初始化所有粒子
    sps.initParticles = () => {
      for (let i = 0; i < TOTAL_CELLS; i++) {
        const p = sps!.particles[i]!
        const y = Math.floor(i / MAP_WIDTH)
        const x = i % MAP_WIDTH
        const cell = cellData[i]!

        p.position.set(
          startX + x * cellWorldSize,
          0,
          startZ + y * cellWorldSize,
        )
        p.rotation.x = -Math.PI / 2 // 平放在 XZ 平面

        const scale = getCellScale(cell)
        p.scaling.set(scale, scale, 1)

        const [r, g, b, a] = getCellColor(cell)
        p.color = new Color4(r, g, b, a)
      }
    }
    sps.initParticles()
    sps.setParticles()
  }

  // ---- 刷新所有粒子颜色和缩放（不需要重建 SPS） ----
  function refreshAllParticles(): void {
    if (!sps) return
    for (let i = 0; i < TOTAL_CELLS; i++) {
      const p = sps.particles[i]!
      const cell = cellData[i]!
      const scale = getCellScale(cell)
      p.scaling.set(scale, scale, 1)
      const [r, g, b, a] = getCellColor(cell)
      p.color = new Color4(r, g, b, a)

      // 变体边界高亮
      if (showVariantBorders && cell.density > 0 && cell.variantIdx > 0) {
        const y = Math.floor(i / MAP_WIDTH)
        const x = i % MAP_WIDTH
        // 检查邻居是否不同变体
        let isBorder = false
        const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]]
        for (const [dx, dy] of neighbors) {
          const nx = x + dx
          const ny = y + dy
          if (nx >= 0 && nx < MAP_WIDTH && ny >= 0 && ny < MAP_HEIGHT) {
            const ni = ny * MAP_WIDTH + nx
            if (cellData[ni]!.type === cell.type && cellData[ni]!.variantIdx !== cell.variantIdx) {
              isBorder = true
              break
            }
          }
        }
        if (isBorder) {
          p.color = new Color4(1, 1, 1, 0.9) // 白色高亮边框 cell
        }
      }
    }
    sps.setParticles()
    updateStats()
  }

  // ---- 重新生成地图 ----
  function regenerate(): void {
    cellData = generateCellData(densityPattern, maxDensity, numVariants, visibleTypes)
    refreshAllParticles()
  }

  // ---- 按钮事件 ----
  btnApplyFilter.addEventListener('click', () => {
    visibleTypes.clear()
    if (showTib.checked) visibleTypes.add('Tiberium')
    if (showOre.checked) visibleTypes.add('Ore')
    if (showSpice.checked) visibleTypes.add('Spice')
    if (showGems.checked) visibleTypes.add('Gems')
    if (visibleTypes.size === 0) {
      // 至少保留一个类型
      visibleTypes.add('Tiberium')
      showTib.checked = true
    }
    regenerate()
  })

  btnRegen.addEventListener('click', () => {
    densityPattern = densityPatternSel.value as DensityPattern
    maxDensity = parseInt(maxDensitySel.value, 10)
    regenerate()
  })

  btnHighlightVariants.addEventListener('click', () => {
    showVariantBorders = !showVariantBorders
    btnHighlightVariants.textContent = showVariantBorders
      ? '隐藏变体边界'
      : '高亮变体边界'
    btnHighlightVariants.style.background = showVariantBorders ? '#e94560' : ''
    btnHighlightVariants.style.color = showVariantBorders ? '#fff' : ''
    refreshAllParticles()
  })

  variantCountSel.addEventListener('change', () => {
    numVariants = parseInt(variantCountSel.value, 10)
    regenerate()
  })

  // ---- 鼠标悬浮提示 ----
  const tooltip = document.getElementById('cell-tooltip')!
  canvas.addEventListener('mousemove', (e: MouseEvent) => {
    if (!sps || !scene) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    const ray = scene.createPickingRay(mx, my, null!, camera)
    if (!ray) return

    const origin = ray.origin
    const dir = ray.direction
    if (Math.abs(dir.y) < 0.001) return
    const t = -origin.y / dir.y
    if (t <= 0) return

    const cellWorldSize = 1.05
    const hitX = origin.x + dir.x * t
    const hitZ = origin.z + dir.z * t

    const col = Math.floor(hitX / cellWorldSize)
    const row = Math.floor(hitZ / cellWorldSize)

    if (col >= 0 && col < MAP_WIDTH && row >= 0 && row < MAP_HEIGHT) {
      const idx = row * MAP_WIDTH + col
      const cell = cellData[idx]!
      if (cell.density > 0) {
        const frameCount = 8
        const frame = lerpFrame(0, frameCount - 1, cell.density, maxDensity)
        tooltip.style.display = 'block'
        tooltip.style.left = `${e.clientX - canvas.getBoundingClientRect().left + 16}px`
        tooltip.style.top = `${e.clientY - canvas.getBoundingClientRect().top - 28}px`
        tooltip.textContent =
          `Cell(${col},${row})\n` +
          `${cell.type} | 密度=${cell.density}/${maxDensity} | 帧=${frame}/${frameCount - 1}\n` +
          `变体=${cell.variantIdx}/${numVariants} | hash=${cellVariantIndex(col, row, numVariants)}`
        return
      }
    }
    tooltip.style.display = 'none'
  })
  canvas.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none'
  })

  // ---- 初始化 ----
  buildSPS()
  updateStats()

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
