/**
 * main.ts — TerrainSpriteLayer 地形瓦片批量渲染人工验收测试
 *
 * 测试目标:
 *   1. 验证地形瓦片网格的批量渲染性能（256-4096 瓦片）
 *   2. 验证脏行更新机制（仅更新变化行，未变化行保持原样）
 *   3. 验证最多 8 个 Sheet 槽位绑定
 *   4. 验证可见区域裁剪对渲染行数的影响
 *
 * OpenRA 对照: TerrainSpriteLayer.ts
 *   - vertexRowStride = 4 * mapSize.width
 *   - vertices.length = vertexRowStride * mapSize.height
 *   - dirtyRows: Set<number>
 *   - sheets: (Sheet|null)[] (max 8)
 *
 * 注意: 本测试页使用 Babylon.js Solid Particle System (SPS) 模拟
 * 地形瓦片批量渲染。SPS 的 updateParticle + setParticles 机制与
 * TerrainSpriteLayer 的 VertexBuffer.updateDirectly() 脏行更新模式类似。
 */

import { Engine } from '@babylonjs/core'
import { Scene } from '@babylonjs/core'
import { ArcRotateCamera } from '@babylonjs/core'
import { HemisphericLight } from '@babylonjs/core'
import { Vector3, Color3, Color4 } from '@babylonjs/core'
import { MeshBuilder } from '@babylonjs/core'
import { StandardMaterial } from '@babylonjs/core'
import { SolidParticleSystem } from '@babylonjs/core'

// ---------------------------------------------------------------------------
// 地形瓦片颜色定义（模拟不同地形类型）
// ---------------------------------------------------------------------------

const TERRAIN_COLORS: Record<string, [number, number, number]> = {
  Clear:   [0.565, 0.933, 0.565],  // #90EE90 — 淡绿平地
  Road:    [0.251, 0.251, 0.251],  // #404040 — 深灰道路
  Rough:   [0.545, 0.271, 0.075],  // #8B4513 — 棕褐粗糙地
  Water:   [0.118, 0.565, 1.000],  // #1E90FF — 蓝色水域
  Wall:    [0.502, 0.502, 0.502],  // #808080 — 灰色墙
  Tiberium:[0.000, 0.800, 0.000],  // #00CC00 — 绿色矿
  Ore:     [0.855, 0.647, 0.125],  // #DAA520 — 金色矿
  Beach:   [0.933, 0.910, 0.667],  // #EEE8AA — 浅黄沙滩
  Cliff:   [0.400, 0.200, 0.000],  // #663300 — 深棕悬崖
  River:   [0.000, 0.400, 0.800],  // #0066CC — 深蓝河流
}

const TERRAIN_NAMES = Object.keys(TERRAIN_COLORS)

/** Sheet 颜色方案（模拟不同纹理表绑定） */
const SHEET_SCHEMES: Record<string, [number, number, number][]> = {
  'default': TERRAIN_NAMES.map(k => TERRAIN_COLORS[k]!),
  'red-tint': TERRAIN_NAMES.map(k => {
    const [r, g, b] = TERRAIN_COLORS[k]!
    return [Math.min(1, r * 1.5), g * 0.5, b * 0.5] as [number, number, number]
  }),
  'green-tint': TERRAIN_NAMES.map(k => {
    const [r, g, b] = TERRAIN_COLORS[k]!
    return [r * 0.5, Math.min(1, g * 1.5), b * 0.5] as [number, number, number]
  }),
  'blue-tint': TERRAIN_NAMES.map(k => {
    const [r, g, b] = TERRAIN_COLORS[k]!
    return [r * 0.5, g * 0.5, Math.min(1, b * 1.5)] as [number, number, number]
  }),
}

// ---------------------------------------------------------------------------
// 地形模式生成函数
// ---------------------------------------------------------------------------

type TerrainPattern = 'checkerboard' | 'gradient-columns' | 'random' | 'stripes'

function generateTerrainData(
  mapSize: number,
  pattern: TerrainPattern,
): number[] {
  const total = mapSize * mapSize
  const data: number[] = new Array(total)

  switch (pattern) {
    case 'checkerboard':
      for (let i = 0; i < total; i++) {
        const row = Math.floor(i / mapSize)
        const col = i % mapSize
        data[i] = (row + col) % 2 === 0 ? 0 /* Clear */ : 2 /* Rough */
      }
      break
    case 'gradient-columns':
      for (let i = 0; i < total; i++) {
        const col = i % mapSize
        // 10 columns per terrain type
        data[i] = Math.min(9, Math.floor(col / Math.max(1, mapSize / 10)))
      }
      break
    case 'random':
      for (let i = 0; i < total; i++) {
        data[i] = Math.floor(Math.random() * 10)
      }
      break
    case 'stripes':
      for (let i = 0; i < total; i++) {
        const row = Math.floor(i / mapSize)
        data[i] = row % 8
      }
      break
  }
  return data
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
    Math.PI / 3,
    18,
    new Vector3(0, 0, 0),
    scene,
  )
  camera.lowerRadiusLimit = 5
  camera.upperRadiusLimit = 80
  camera.panningSensibility = 0
  // Lock to top-down-ish view
  camera.upperBetaLimit = Math.PI / 2
  camera.attachControl(canvas, true)

  // ---- 光照 ----
  const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
  light.intensity = 0.85

  // ---- 状态变量 ----
  let mapSize = 16
  let terrainData = generateTerrainData(mapSize, 'checkerboard')
  let dirtyRows = new Set<number>()
  let activeSheetIndex = 0
  const sheetSlotsUsed = new Set<number>([0])

  // SPS 引用
  let sps: SolidParticleSystem | null = null
  let spsMesh: ReturnType<typeof MeshBuilder.CreatePlane> | null = null

  // ---- UI 引用 ----
  const mapSizeSel = document.getElementById('map-size') as HTMLSelectElement
  const patternSel = document.getElementById('terrain-pattern') as HTMLSelectElement
  const btnApplyTerrain = document.getElementById('btn-apply-terrain') as HTMLButtonElement
  const updateRowSlider = document.getElementById('update-row') as HTMLInputElement
  const updateRowVal = document.getElementById('update-row-val')!
  const updateColorSel = document.getElementById('update-color') as HTMLSelectElement
  const btnUpdateRow = document.getElementById('btn-update-row') as HTMLButtonElement
  const btnUpdateRandom = document.getElementById('btn-update-random-cell') as HTMLButtonElement
  const btnCommitDirty = document.getElementById('btn-commit-dirty') as HTMLButtonElement
  const activeSheetSel = document.getElementById('active-sheet') as HTMLSelectElement
  const btnSwitchSheet = document.getElementById('btn-switch-sheet') as HTMLButtonElement

  const statMapSize = document.getElementById('stat-map-size')!
  const statTiles = document.getElementById('stat-tiles')!
  const statVertices = document.getElementById('stat-vertices')!
  const statDirtyRows = document.getElementById('stat-dirty-rows')!
  const statActiveSheets = document.getElementById('stat-active-sheets')!
  const statUpdateTime = document.getElementById('stat-update-time')!
  const statCommitTime = document.getElementById('stat-commit-time')!
  const dirtyRowsDisplay = document.getElementById('dirty-rows-display')!

  // ---- 更新统计信息 ----
  function updateStats(): void {
    statMapSize.textContent = `${mapSize}x${mapSize}`
    statTiles.textContent = String(mapSize * mapSize)
    statVertices.textContent = String(4 * mapSize * mapSize)
    statDirtyRows.textContent = String(dirtyRows.size)
    statActiveSheets.textContent = `${sheetSlotsUsed.size} / 8`
    if (dirtyRows.size === 0) {
      dirtyRowsDisplay.textContent = '(无)'
    } else {
      const rows = [...dirtyRows].sort((a, b) => a - b)
      dirtyRowsDisplay.textContent = rows.slice(0, 20).join(', ') +
        (rows.length > 20 ? ` ... (+${rows.length - 20} 行)` : '')
    }
  }

  // ---- 更新行滑块范围 ----
  function updateSliderRange(): void {
    updateRowSlider.max = String(mapSize - 1)
    if (parseInt(updateRowSlider.value, 10) >= mapSize) {
      updateRowSlider.value = String(Math.min(3, mapSize - 1))
    }
    updateRowVal.textContent = updateRowSlider.value
  }

  updateRowSlider.addEventListener('input', () => {
    updateRowVal.textContent = updateRowSlider.value
  })

  // ---- 地形瓦片颜色获取 ----
  function getTileColor(cellIndex: number): [number, number, number] {
    const terrainIdx = terrainData[cellIndex]!
    const scheme = SHEET_SCHEMES[activeSheetIndex === 0 ? 'default'
      : activeSheetIndex === 1 ? 'red-tint'
      : activeSheetIndex === 2 ? 'green-tint'
      : 'blue-tint']!
    return scheme[terrainIdx]!
  }

  // ---- 创建/重建 SPS ----
  function buildSPS(): void {
    // 清理旧资源
    if (sps) {
      sps.dispose()
      sps = null
    }
    if (spsMesh) {
      spsMesh.dispose()
      spsMesh = null
    }

    const totalCells = mapSize * mapSize
    const cellWorldSize = Math.max(0.3, 12 / mapSize)
    const halfExtent = (mapSize * cellWorldSize) / 2

    // 创建 SPS：每个瓦片一个粒子
    spsMesh = MeshBuilder.CreatePlane('spsPlane', { width: 1, height: 1 }, scene)
    spsMesh.isVisible = false

    sps = new SolidParticleSystem('terrainSPS', scene, { updatable: true })
    sps.addShape(spsMesh, totalCells)
    spsMesh.dispose()
    spsMesh = null  // ownership transferred to SPS

    const spsActualMesh = sps.buildMesh()
    spsActualMesh.material = createTileMaterial(scene)

    // 初始化所有粒子
    sps.initParticles = () => {
      for (let i = 0; i < sps!.nbParticles; i++) {
        const p = sps!.particles[i]!
        const row = Math.floor(i / mapSize)
        const col = i % mapSize
        const x = col * cellWorldSize - halfExtent + cellWorldSize / 2
        const z = row * cellWorldSize - halfExtent + cellWorldSize / 2

        p.position.set(x, 0, z)
        p.rotation.x = -Math.PI / 2  // Lay the XY plane flat onto the XZ ground plane
        p.scaling.set(cellWorldSize * 0.92, cellWorldSize * 0.92, 1)
        p.isVisible = true

        const [r, g, b] = getTileColor(i)
        p.color = new Color4(r, g, b, 1)
      }
    }
    sps.initParticles()
    sps.setParticles()

    dirtyRows.clear()
    updateStats()
  }

  // ---- 瓦片材质 ----
  function createTileMaterial(scn: Scene): StandardMaterial {
    const mat = new StandardMaterial('tileMat', scn)
    mat.emissiveColor = new Color3(1, 1, 1)
    mat.specularColor.set(0, 0, 0)
    mat.disableLighting = true
    mat.backFaceCulling = false
    return mat
  }

  // ---- 更新单格 ----
  function updateCell(cellIndex: number): void {
    if (!sps || cellIndex < 0 || cellIndex >= sps.nbParticles) return
    const p = sps.particles[cellIndex]!
    const [r, g, b] = getTileColor(cellIndex)
    p.color = new Color4(r, g, b, 1)
    const row = Math.floor(cellIndex / mapSize)
    dirtyRows.add(row)
  }

  // ---- 更新整行 ----
  function updateRow(rowIndex: number, forceColor?: [number, number, number]): void {
    if (!sps || rowIndex < 0 || rowIndex >= mapSize) return

    const startTime = performance.now()
    const startIdx = rowIndex * mapSize
    for (let col = 0; col < mapSize; col++) {
      const cellIndex = startIdx + col
      const p = sps.particles[cellIndex]!
      if (forceColor) {
        p.color = new Color4(forceColor[0], forceColor[1], forceColor[2], 1)
      } else {
        const [r, g, b] = getTileColor(cellIndex)
        p.color = new Color4(r, g, b, 1)
      }
    }
    dirtyRows.add(rowIndex)
    updateStats()
    const elapsed = (performance.now() - startTime).toFixed(2)
    statUpdateTime.textContent = `${elapsed} ms`
  }

  // ---- 提交脏行到 GPU ----
  function commitDirtyRows(): void {
    if (!sps || dirtyRows.size === 0) return

    const dirtyCount = dirtyRows.size  // 记录提交前的脏行数

    const startTime = performance.now()
    sps.setParticles()
    const elapsed = (performance.now() - startTime).toFixed(2)
    statCommitTime.textContent = `${elapsed} ms`

    dirtyRows.clear()
    updateStats()
    statDirtyRows.textContent = String(dirtyCount)  // 显示本次提交的脏行数
  }

  // ---- 按钮事件 ----
  btnApplyTerrain.addEventListener('click', () => {
    const newSize = parseInt(mapSizeSel.value, 10)
    const newPattern = patternSel.value as TerrainPattern
    if (newSize !== mapSize) {
      mapSize = newSize
      updateSliderRange()
    }
    terrainData = generateTerrainData(mapSize, newPattern)
    buildSPS()
    updateStats()
  })

  btnUpdateRow.addEventListener('click', () => {
    const row = parseInt(updateRowSlider.value, 10)
    const hex = updateColorSel.value
    const r = parseInt(hex.slice(1, 3), 16) / 255
    const g = parseInt(hex.slice(3, 5), 16) / 255
    const b = parseInt(hex.slice(5, 7), 16) / 255
    updateRow(row, [r, g, b])
    // 自动提交
    commitDirtyRows()
  })

  btnUpdateRandom.addEventListener('click', () => {
    if (!sps) return
    const cellIndex = Math.floor(Math.random() * sps.nbParticles)
    // 随机分配新地形类型
    terrainData[cellIndex] = Math.floor(Math.random() * 10)
    updateCell(cellIndex)
    commitDirtyRows()
  })

  btnCommitDirty.addEventListener('click', () => {
    commitDirtyRows()
  })

  btnSwitchSheet.addEventListener('click', () => {
    const newSheetIdx = parseInt(activeSheetSel.value, 10)
    if (newSheetIdx === activeSheetIndex) return
    activeSheetIndex = newSheetIdx
    sheetSlotsUsed.add(newSheetIdx)

    // 重建所有粒子颜色以反映新 Sheet
    if (sps) {
      const startTime = performance.now()
      for (let i = 0; i < sps.nbParticles; i++) {
        const p = sps.particles[i]!
        const [r, g, b] = getTileColor(i)
        p.color = new Color4(r, g, b, 1)
        dirtyRows.add(Math.floor(i / mapSize))
      }
      const elapsed = (performance.now() - startTime).toFixed(2)
      statUpdateTime.textContent = `${elapsed} ms`
      commitDirtyRows()
      updateStats()
    }
  })

  // ---- 鼠标悬浮提示 ----
  const tooltip = document.getElementById('cell-tooltip')!
  canvas.addEventListener('mousemove', (e: MouseEvent) => {
    if (!sps || !scene) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // 使用射线平面交点计算（y=0 平面）进行空间定位
    const cellWorldSize = Math.max(0.3, 12 / mapSize)
    const halfExtent = (mapSize * cellWorldSize) / 2

    const ray = scene.createPickingRay(x, y, null!, camera)
    if (ray) {
        const origin = ray.origin
        const dir = ray.direction
        if (Math.abs(dir.y) > 0.001) {
          const t = -origin.y / dir.y
          if (t > 0) {
            const hitX = origin.x + dir.x * t
            const hitZ = origin.z + dir.z * t
            const col = Math.floor((hitX + halfExtent) / cellWorldSize)
            const row = Math.floor((hitZ + halfExtent) / cellWorldSize)
            if (col >= 0 && col < mapSize && row >= 0 && row < mapSize) {
              const cellIndex = row * mapSize + col
              const terrainIdx = terrainData[cellIndex]!
              const [r, g, b] = getTileColor(cellIndex)
              const hexR = Math.round(r * 255).toString(16).padStart(2, '0')
              const hexG = Math.round(g * 255).toString(16).padStart(2, '0')
              const hexB = Math.round(b * 255).toString(16).padStart(2, '0')

              tooltip.style.display = 'block'
              tooltip.style.left = `${e.clientX - canvas.getBoundingClientRect().left + 16}px`
              tooltip.style.top = `${e.clientY - canvas.getBoundingClientRect().top - 28}px`
              tooltip.textContent = `W[${col},${row}] idx=${cellIndex} terrain=${TERRAIN_NAMES[terrainIdx]} color=#${hexR}${hexG}${hexB} sheet=${activeSheetIndex}`
              return
            }
          }
        }
      }
    tooltip.style.display = 'none'
  })

  canvas.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none'
  })

  // ---- 点击更新单元格 ----
  canvas.addEventListener('click', (e: MouseEvent) => {
    if (!sps || !scene) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const ray = scene.createPickingRay(x, y, null!, camera)
    if (!ray) return

    const origin = ray.origin
    const dir = ray.direction
    if (Math.abs(dir.y) < 0.001) return
    const t = -origin.y / dir.y
    if (t <= 0) return

    const cellWorldSize = Math.max(0.3, 12 / mapSize)
    const halfExtent = (mapSize * cellWorldSize) / 2

    const hitX = origin.x + dir.x * t
    const hitZ = origin.z + dir.z * t
    const col = Math.floor((hitX + halfExtent) / cellWorldSize)
    const row = Math.floor((hitZ + halfExtent) / cellWorldSize)

    if (col >= 0 && col < mapSize && row >= 0 && row < mapSize) {
      const cellIndex = row * mapSize + col
      // 循环切换地形类型
      terrainData[cellIndex] = (terrainData[cellIndex]! + 1) % 10
      updateCell(cellIndex)
      commitDirtyRows()

      // 高亮闪烁效果
      const p = sps.particles[cellIndex]!
      const origColor = p.color ?? new Color4(1, 1, 1, 1)
      p.color = new Color4(1, 1, 1, 1)
      sps.setParticles()
      setTimeout(() => {
        if (sps && cellIndex < sps.nbParticles) {
          const p2 = sps.particles[cellIndex]!
          p2.color = origColor
          sps.setParticles()
        }
      }, 100)
    }
  })

  // ---- 初始化 ----
  buildSPS()
  updateSliderRange()
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
