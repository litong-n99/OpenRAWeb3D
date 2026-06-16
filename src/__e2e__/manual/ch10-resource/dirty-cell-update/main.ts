/**
 * main.ts — ResourceRenderer 脏 Cell 增量更新渲染 人工验收测试
 *
 * 测试目标:
 *   1. 验证当资源被采集（密度下降）时，仅受影响 cell 重新渲染
 *   2. 验证密度帧随密度下降正确更新（逐步变小/变暗）
 *   3. 验证 cell 清空时精灵正确移除（变为空 cell 外观）
 *   4. 验证脏 cell 队列的批量处理机制
 *   5. 验证密集采集场景下无视觉撕裂或更新遗漏
 *
 * OpenRA 对照: ResourceRenderer.ts
 *   - _addDirtyCell(cell, resourceType) — line 534 (加入 dirty set)
 *   - tickRender(wr, self) — line 863 (遍历 dirty set，更新精灵)
 *   - _cleanDirty queue — line 454 (处理完后从 set 移除)
 *   - _updateRenderedSprite(cell, content) — line 786 (密度→帧更新)
 *   - _cellKey(cell) — line 547 (CPos→int key for Set)
 *
 * 本测试页模拟完整的 dirty-cell 更新管线：
 *   - 资源采集 → _addDirtyCell()
 *   - 渲染 tick → tickRender() 处理 dirty set
 *   - 精灵更新 → _updateRenderedSprite() 密度→帧/颜色/缩放
 *   - 脏 cell 用红色边框高亮显示
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
// 资源类型配置
// ---------------------------------------------------------------------------

interface ResourceConfig {
  name: string
  baseColor: [number, number, number]
  fullColor: [number, number, number]
  maxDensity: number
}

const RESOURCE: ResourceConfig = {
  name: 'Tiberium',
  baseColor: [0.05, 0.25, 0.08],
  fullColor: [0.00, 0.80, 0.27],
  maxDensity: 10,
}

// ---------------------------------------------------------------------------
// 核心算法：直接从 ResourceRenderer 移植
// ---------------------------------------------------------------------------

/** 密度 → 帧索引插值 (ResourceRenderer L370) */
function lerpFrame(a: number, b: number, mu: number, muMax: number): number {
  if (muMax <= 0) return a
  const t = mu / muMax
  return Math.round(a + (b - a) * t)
}

/** CPos → int key (ResourceRenderer L547) */
function cellKey(x: number, y: number): number {
  return ((y & 0xffff) << 16) | (x & 0xffff)
}

// ---------------------------------------------------------------------------
// 地图常量
// ---------------------------------------------------------------------------

const MAP_WIDTH = 16
const MAP_HEIGHT = 12
const TOTAL_CELLS = MAP_WIDTH * MAP_HEIGHT

// ---------------------------------------------------------------------------
// Cell 状态
// ---------------------------------------------------------------------------

interface CellState {
  /** 密度（0=已枯竭） */
  density: number
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

  // ---- 摄像机 ----
  const camera = new ArcRotateCamera(
    'cam',
    -Math.PI / 2,
    Math.PI / 4,
    17,
    new Vector3(0, 0, 0),
    scene,
  )
  camera.lowerRadiusLimit = 5
  camera.upperRadiusLimit = 40
  camera.lowerBetaLimit = 0.1
  camera.upperBetaLimit = Math.PI / 2.2
  camera.attachControl(canvas, true)

  // ---- 光照 ----
  const hemiLight = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)
  hemiLight.intensity = 0.5
  const dirLight = new DirectionalLight('dir', new Vector3(0.5, -0.8, 0.3), scene)
  dirLight.intensity = 0.6

  // ---- 地形底板 ----
  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.diffuseColor = new Color3(0.22, 0.18, 0.13)
  groundMat.specularColor.set(0, 0, 0)
  const ground = MeshBuilder.CreateGround('ground', {
    width: MAP_WIDTH * 1.05 + 0.2,
    height: MAP_HEIGHT * 1.05 + 0.2,
  }, scene)
  ground.position.set((MAP_WIDTH - 1) / 2 * 1.05, -0.15, (MAP_HEIGHT - 1) / 2 * 1.05)
  ground.material = groundMat

  // ---- 状态变量 ----
  // Cell 数据
  const cellStates: CellState[] = new Array(TOTAL_CELLS)
  for (let i = 0; i < TOTAL_CELLS; i++) {
    cellStates[i] = { density: RESOURCE.maxDensity }
  }

  // 脏 cell 集合（模拟 ResourceRenderer._dirty Set<number>）
  const dirtySet = new Set<number>()

  // 处理队列（模拟 ResourceRenderer._cleanDirty CPos[]）
  const cleanDirtyQueue: number[] = []

  // SPS 引用
  let sps: SolidParticleSystem | null = null

  // 自动采集计时器
  let autoHarvestTimer: ReturnType<typeof setInterval> | null = null

  // 处理统计
  let processedTotal = 0

  // ---- UI 引用 ----
  const harvestCellX = document.getElementById('harvest-cell-x') as HTMLInputElement
  const harvestCellY = document.getElementById('harvest-cell-y') as HTMLInputElement
  const harvestXVal = document.getElementById('harvest-x-val')!
  const harvestYVal = document.getElementById('harvest-y-val')!
  const btnHarvestDecrement = document.getElementById('btn-harvest-decrement') as HTMLButtonElement
  const btnHarvestClear = document.getElementById('btn-harvest-clear') as HTMLButtonElement
  const btnRandomHarvest = document.getElementById('btn-random-harvest') as HTMLButtonElement
  const btnAutoStart = document.getElementById('btn-auto-start') as HTMLButtonElement
  const btnAutoStop = document.getElementById('btn-auto-stop') as HTMLButtonElement
  const autoSpeedSel = document.getElementById('auto-speed') as HTMLSelectElement
  const btnProcessOne = document.getElementById('btn-process-one') as HTMLButtonElement
  const btnProcessAll = document.getElementById('btn-process-all') as HTMLButtonElement
  const btnClearDirty = document.getElementById('btn-clear-dirty') as HTMLButtonElement
  const btnReplenish = document.getElementById('btn-replenish') as HTMLButtonElement

  const statResourceCells = document.getElementById('stat-resource-cells')!
  const statDepletedCells = document.getElementById('stat-depleted-cells')!
  const dirtyIndicator = document.getElementById('dirty-indicator')!
  const statDirtyCount = document.getElementById('stat-dirty-count')!
  const statProcessedTotal = document.getElementById('stat-processed-total')!
  const statUpdateTime = document.getElementById('stat-update-time')!
  const dirtyListDisplay = document.getElementById('dirty-list-display')!

  // ---- 计算 cell 颜色 ----
  function getCellColor(density: number): [number, number, number, number] {
    if (density <= 0) {
      // 已枯竭：淡灰半透明
      return [0.12, 0.10, 0.08, 0.25]
    }
    const frameCount = 8
    const frame = lerpFrame(0, frameCount - 1, density, RESOURCE.maxDensity)
    const t = frame / (frameCount - 1)
    const base = RESOURCE.baseColor
    const full = RESOURCE.fullColor
    return [
      base[0] + (full[0] - base[0]) * t,
      base[1] + (full[1] - base[1]) * t,
      base[2] + (full[2] - base[2]) * t,
      0.7 + t * 0.3,
    ]
  }

  function getCellScale(density: number): number {
    if (density <= 0) return 0.12
    const frameCount = 8
    const frame = lerpFrame(0, frameCount - 1, density, RESOURCE.maxDensity)
    const t = frame / (frameCount - 1)
    return 0.25 + t * 0.70
  }

  // ---- 更新单个粒子 ----
  function updateParticle(index: number): void {
    if (!sps || index < 0 || index >= TOTAL_CELLS) return
    const p = sps.particles[index]!
    const cell = cellStates[index]!
    const scale = getCellScale(cell.density)
    p.scaling.set(scale, scale, 1)
    const [r, g, b, a] = getCellColor(cell.density)
    p.color = new Color4(r, g, b, a)
  }

  // ---- 标记脏 cell（模拟 ResourceRenderer._addDirtyCell） ----
  function addDirtyCell(x: number, y: number): void {
    const key = cellKey(x, y)
    dirtySet.add(key)
  }

  // ---- 更新所有统计 ----
  function updateAllStats(): void {
    let resourceCount = 0
    let depletedCount = 0
    for (const cell of cellStates) {
      if (cell.density > 0) resourceCount++
      else depletedCount++
    }
    statResourceCells.textContent = String(resourceCount)
    statDepletedCells.textContent = String(depletedCount)
    statDirtyCount.textContent = String(dirtySet.size)
    statProcessedTotal.textContent = String(processedTotal)

    // 脏指示器
    dirtyIndicator.className = dirtySet.size > 0
      ? 'dirty-highlight dirty'
      : 'dirty-highlight clean'

    // 脏 cell 列表
    if (dirtySet.size === 0) {
      dirtyListDisplay.textContent = '(无)'
    } else {
      const items: string[] = []
      const seen = new Set<number>()
      for (const key of dirtySet) {
        const x = key & 0xffff
        const y = (key >> 16) & 0xffff
        items.push(`(${x},${y})`)
        seen.add(key)
        if (items.length >= 30) break
      }
      dirtyListDisplay.textContent = items.join(' ') +
        (seen.size > 30 ? ` ... (+${seen.size - 30} 更多)` : '')
    }
  }

  // ---- 处理脏 cell（模拟 ResourceRenderer.tickRender） ----
  function processOneDirtyCell(): boolean {
    if (dirtySet.size === 0) return false

    const startTime = performance.now()

    // 从 dirty set 取一个 key（迭代器第一个）
    const key = dirtySet.values().next().value as number
    const x = key & 0xffff
    const y = (key >> 16) & 0xffff
    const index = y * MAP_WIDTH + x

    // 更新精灵
    updateParticle(index)

    // 移入清理队列
    cleanDirtyQueue.push(key)

    // 从 dirty set 移除
    dirtySet.delete(key)

    processedTotal++

    const elapsed = (performance.now() - startTime).toFixed(2)
    statUpdateTime.textContent = `${elapsed} ms`

    updateAllStats()
    return true
  }

  function processAllDirtyCells(): number {
    const startTime = performance.now()
    let count = 0

    // 先收集所有 key 到 cleanDirtyQueue
    for (const key of dirtySet) {
      const x = key & 0xffff
      const y = (key >> 16) & 0xffff
      const index = y * MAP_WIDTH + x
      updateParticle(index)
      cleanDirtyQueue.push(key)
      count++
    }

    // 清空 dirty set
    dirtySet.clear()

    processedTotal += count

    const elapsed = (performance.now() - startTime).toFixed(2)
    statUpdateTime.textContent = `${elapsed} ms (${count} cells)`

    // 提交 GPU 更新
    if (sps) {
      sps.setParticles()
    }

    updateAllStats()
    return count
  }

  // ---- 采集操作 ----
  function harvestCell(x: number, y: number): void {
    if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) return
    const index = y * MAP_WIDTH + x
    const cell = cellStates[index]!

    if (cell.density <= 0) return // 已枯竭

    // 减少密度
    cell.density = Math.max(0, cell.density - 1)

    // 标记为脏
    addDirtyCell(x, y)

    // 自动处理（使效果立即可见）
    processAllDirtyCells()
  }

  function clearCell(x: number, y: number): void {
    if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) return
    const index = y * MAP_WIDTH + x
    const cell = cellStates[index]!

    if (cell.density === 0) return

    cell.density = 0
    addDirtyCell(x, y)
    processAllDirtyCells()
  }

  function harvestRandomCell(): void {
    // 优先选择有资源的 cell
    const candidates: number[] = []
    for (let i = 0; i < TOTAL_CELLS; i++) {
      if (cellStates[i]!.density > 0) candidates.push(i)
    }
    if (candidates.length === 0) return

    const index = candidates[Math.floor(Math.random() * candidates.length)]!
    const x = index % MAP_WIDTH
    const y = Math.floor(index / MAP_WIDTH)
    harvestCell(x, y)
  }

  function replenishAll(): void {
    const startTime = performance.now()
    for (let i = 0; i < TOTAL_CELLS; i++) {
      cellStates[i]!.density = RESOURCE.maxDensity
      const y = Math.floor(i / MAP_WIDTH)
      const x = i % MAP_WIDTH
      addDirtyCell(x, y)
    }
    processAllDirtyCells()
    const elapsed = (performance.now() - startTime).toFixed(2)
    statUpdateTime.textContent = `${elapsed} ms (replenish all)`
    updateAllStats()
  }

  // ---- 构建 SPS ----
  function buildSPS(): void {
    if (sps) {
      sps.dispose()
      sps = null
    }

    const cellWorldSize = 1.05

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

    // 初始化
    sps.initParticles = () => {
      for (let i = 0; i < TOTAL_CELLS; i++) {
        const p = sps!.particles[i]!
        const y = Math.floor(i / MAP_WIDTH)
        const x = i % MAP_WIDTH
        const cell = cellStates[i]!

        p.position.set(x * cellWorldSize, 0, y * cellWorldSize)
        p.rotation.x = -Math.PI / 2

        const scale = getCellScale(cell.density)
        p.scaling.set(scale, scale, 1)

        const [r, g, b, a] = getCellColor(cell.density)
        p.color = new Color4(r, g, b, a)
        p.isVisible = true
      }
    }
    sps.initParticles()
    sps.setParticles()
  }

  // ---- 按钮事件 ----
  harvestCellX.addEventListener('input', () => {
    harvestXVal.textContent = harvestCellX.value
  })
  harvestCellY.addEventListener('input', () => {
    harvestYVal.textContent = harvestCellY.value
  })

  btnHarvestDecrement.addEventListener('click', () => {
    const x = parseInt(harvestCellX.value, 10)
    const y = parseInt(harvestCellY.value, 10)
    harvestCell(x, y)
  })

  btnHarvestClear.addEventListener('click', () => {
    const x = parseInt(harvestCellX.value, 10)
    const y = parseInt(harvestCellY.value, 10)
    clearCell(x, y)
  })

  btnRandomHarvest.addEventListener('click', () => {
    harvestRandomCell()
  })

  btnProcessOne.addEventListener('click', () => {
    if (dirtySet.size > 0) {
      processOneDirtyCell()
      // 提交 GPU
      if (sps) sps.setParticles()
    }
  })

  btnProcessAll.addEventListener('click', () => {
    processAllDirtyCells()
  })

  btnClearDirty.addEventListener('click', () => {
    dirtySet.clear()
    cleanDirtyQueue.length = 0
    updateAllStats()
  })

  btnReplenish.addEventListener('click', () => {
    replenishAll()
  })

  btnAutoStart.addEventListener('click', () => {
    btnAutoStart.style.display = 'none'
    btnAutoStop.style.display = ''
    const speed = parseInt(autoSpeedSel.value, 10)
    autoHarvestTimer = setInterval(() => {
      harvestRandomCell()
    }, speed)
  })

  btnAutoStop.addEventListener('click', () => {
    btnAutoStart.style.display = ''
    btnAutoStop.style.display = 'none'
    if (autoHarvestTimer) {
      clearInterval(autoHarvestTimer)
      autoHarvestTimer = null
    }
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
    const col = Math.round(hitX / cellWorldSize)
    const row = Math.round(hitZ / cellWorldSize)

    if (col >= 0 && col < MAP_WIDTH && row >= 0 && row < MAP_HEIGHT) {
      const idx = row * MAP_WIDTH + col
      const cell = cellStates[idx]!
      const key = cellKey(col, row)
      const isDirty = dirtySet.has(key)
      const frameCount = 8
      const frame = lerpFrame(0, frameCount - 1, cell.density, RESOURCE.maxDensity)

      tooltip.style.display = 'block'
      tooltip.style.left = `${e.clientX - canvas.getBoundingClientRect().left + 16}px`
      tooltip.style.top = `${e.clientY - canvas.getBoundingClientRect().top - 28}px`
      tooltip.textContent =
        `Cell(${col},${row}) 密度=${cell.density}/${RESOURCE.maxDensity} 帧=${frame}` +
        (isDirty ? ' [脏]' : '')
      return
    }
    tooltip.style.display = 'none'
  })
  canvas.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none'
  })

  // ---- 点击采集 ----
  canvas.addEventListener('click', (e: MouseEvent) => {
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
    const col = Math.round(hitX / cellWorldSize)
    const row = Math.round(hitZ / cellWorldSize)

    if (col >= 0 && col < MAP_WIDTH && row >= 0 && row < MAP_HEIGHT) {
      harvestCell(col, row)
    }
  })

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

  // ---- 初始化 ----
  buildSPS()
  updateAllStats()
}

main().catch((err: unknown) => {
  console.error('[fatal] main() failed:', err)
  const errorEl = document.getElementById('gpu-error')!
  errorEl.style.display = 'flex'
  errorEl.textContent = `初始化失败: ${err instanceof Error ? err.message : String(err)}`
})
