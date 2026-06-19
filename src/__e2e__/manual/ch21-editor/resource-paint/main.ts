/**
 * main.ts — EditorResourceLayer 资源绘制笔刷人工验收测试
 *
 * 测试目标:
 *   1. 验证资源类型选择与颜色映射的正确性
 *   2. 验证笔刷绘制密度与颜色强度的线性关系
 *   3. 验证一次笔刷 stroke 在多个 cell 上的正确绘制
 *   4. 验证可见性切换 (toggle) 的即时响应
 *   5. 验证 EditorResourceLayer 数据模型与视觉表现的一致性
 *
 * OpenRA 对照: EditorResourceLayer.cs, ResourceLayer.cs
 *
 * __testHarness API:
 *   selectResource(type)  — 选择资源类型 ("ore"|"gems"|"tiberium")
 *   paintCell(cell, density) — 在指定 cell 绘制指定密度
 *   getCellDensity(cell) — 获取指定 cell 的资源密度百分比
 *   getResourceColor(cell) — 获取 cell 当前颜色 (HEX)
 *   reset() — 清除所有资源
 */

import { Engine } from '@babylonjs/core'
import { Scene } from '@babylonjs/core'
import { ArcRotateCamera } from '@babylonjs/core'
import { HemisphericLight } from '@babylonjs/core'
import { Vector3 } from '@babylonjs/core'
import { Color3 } from '@babylonjs/core'
import { MeshBuilder } from '@babylonjs/core'
import { StandardMaterial } from '@babylonjs/core'
import type { AbstractMesh } from '@babylonjs/core'
import type { PointerInfo } from '@babylonjs/core'

import { CPos } from '../../../../OpenRA.Game/CPos'
import {
  EditorResourceLayer,
  EditorResourceLayerInfo,
} from '../../../../OpenRA.Mods.Common/Traits/World/EditorResourceLayer'
import type { ResourceTypeInfoConfig } from '../../../../OpenRA.Mods.Common/Traits/World/ResourceLayer'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 网格列数 */
const GRID_COLS = 10
/** 网格行数 */
const GRID_ROWS = 8
/** 每个 cell 的世界空间尺寸 */
const CELL_SIZE = 1.0
/** 网格 Y 位置偏移 (地面高度) */
const GRID_Y = 0
/** 网格 X 偏移 (居中) */
const GRID_X_OFFSET = -(GRID_COLS * CELL_SIZE) / 2 + CELL_SIZE / 2
/** 网格 Z 偏移 (居中) */
const GRID_Z_OFFSET = -(GRID_ROWS * CELL_SIZE) / 2 + CELL_SIZE / 2

/** 空 cell 颜色 (深灰地面) */
const GROUND_COLOR = new Color3(0.2, 0.2, 0.2)  // #333333

/** 资源类型颜色映射 (100% density 时的颜色) */
const RESOURCE_COLORS: Record<string, Color3> = {
  ore: new Color3(200 / 255, 100 / 255, 30 / 255),     // #C8641E 橙棕色
  gems: new Color3(100 / 255, 150 / 255, 255 / 255),   // #6496FF 蓝白色
  tiberium: new Color3(0 / 255, 204 / 255, 0 / 255),  // #00CC00 绿色
}

/** 资源类型 HEX 颜色 (100% density) */
const RESOURCE_COLORS_HEX: Record<string, string> = {
  ore: '#C8641E',
  gems: '#6496FF',
  tiberium: '#00CC00',
}

/** 资源类型最大密度 */
const RESOURCE_MAX_DENSITY: Record<string, number> = {
  ore: 10,
  gems: 5,
  tiberium: 12,
}

/** 网格中 cell 对应的 ground plane mesh 名称前缀 */
const CELL_MESH_PREFIX = 'cell_'

// ---------------------------------------------------------------------------
// 网格坐标 ↔ 世界坐标转换
// ---------------------------------------------------------------------------

/** 将网格坐标 (col, row) 转换为世界空间 XZ 位置 */
function gridToWorld(col: number, row: number): { x: number; z: number } {
  return {
    x: GRID_X_OFFSET + col * CELL_SIZE,
    z: GRID_Z_OFFSET + row * CELL_SIZE,
  }
}

/** 从 cell mesh 名称中提取网格坐标 */
function parseCellMeshName(name: string): { col: number; row: number } | null {
  if (!name.startsWith(CELL_MESH_PREFIX)) return null
  const parts = name.slice(CELL_MESH_PREFIX.length).split('_')
  if (parts.length !== 2) return null
  const col = parseInt(parts[0], 10)
  const row = parseInt(parts[1], 10)
  if (isNaN(col) || isNaN(row)) return null
  return { col, row }
}

/** 将网格坐标转换为 CPos (EditorResourceLayer 使用 CPos) */
function gridToCPos(col: number, row: number): CPos {
  return new CPos(col, row)
}

// ---------------------------------------------------------------------------
// 颜色插值
// ---------------------------------------------------------------------------

/** 线性插值两个 Color3，t 在 [0, 1] 之间 */
function lerpColor3(a: Color3, b: Color3, t: number): Color3 {
  return new Color3(
    a.r + (b.r - a.r) * t,
    a.g + (b.g - a.g) * t,
    a.b + (b.b - a.b) * t,
  )
}

/** 将 Color3 转换为 HEX 字符串 */
function color3ToHex(c: Color3): string {
  const r = Math.round(c.r * 255)
  const g = Math.round(c.g * 255)
  const b = Math.round(c.b * 255)
  return `#${r.toString(16).padStart(2, '0').toUpperCase()}${g.toString(16).padStart(2, '0').toUpperCase()}${b.toString(16).padStart(2, '0').toUpperCase()}`
}

// ---------------------------------------------------------------------------
// 主函数
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // ---- 环境信息采集 ----
  const infoUa = document.getElementById('info-ua')!
  const infoViewport = document.getElementById('info-viewport')!
  const infoEngine = document.getElementById('info-engine')!
  const infoFps = document.getElementById('info-fps')!
  const infoFrameTime = document.getElementById('info-frame-time')!
  const infoTime = document.getElementById('info-time')!
  const infoGridSize = document.getElementById('info-grid-size')!
  const infoPaintedCells = document.getElementById('info-painted-cells')!
  const infoNetWorth = document.getElementById('info-net-worth')!
  const hoverCellInfo = document.getElementById('hover-cell-info')!

  infoUa.textContent = navigator.userAgent.slice(0, 80)
  infoViewport.textContent = `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
  infoTime.textContent = new Date().toISOString()
  infoGridSize.textContent = `${GRID_COLS}×${GRID_ROWS}`

  const updateViewport = (): void => {
    infoViewport.textContent = `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
  }
  window.addEventListener('resize', updateViewport)

  // ---- Babylon.js 初始化 ----
  const sandboxEl = document.getElementById('sandbox')!
  const canvas = document.createElement('canvas')
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  const sandboxRect = sandboxEl.getBoundingClientRect()
  canvas.width = Math.max(sandboxRect.width || 800, 1)
  canvas.height = Math.max(sandboxRect.height || 600, 1)
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

  const webGlVersion = engine.webGLVersion
  infoEngine.textContent = `Babylon.js v${Engine.Version} / WebGL ${webGlVersion}.0`

  // ---- 场景 ----
  const scene = new Scene(engine)
  scene.clearColor.set(0.10, 0.11, 0.14, 1)

  // ---- 相机 (俯视正交) ----
  const camera = new ArcRotateCamera(
    'cam',
    -Math.PI / 2,
    0.25,
    12,
    new Vector3(0, 0, 0),
    scene,
  )
  camera.mode = 1 // ORTHOGRAPHIC_CAMERA
  camera.lowerRadiusLimit = 4
  camera.upperRadiusLimit = 30
  camera.panningSensibility = 200
  camera.inputs.clear()
  camera.inputs.addMouseWheel()
  // 设置正交视锥以容纳整个网格 + 边距
  const orthoSize = Math.max(GRID_COLS, GRID_ROWS) * 0.7
  camera.orthoTop = orthoSize
  camera.orthoBottom = -orthoSize
  camera.orthoLeft = -orthoSize * (sandboxRect.width / Math.max(sandboxRect.height, 1))
  camera.orthoRight = orthoSize * (sandboxRect.width / Math.max(sandboxRect.height, 1))

  // ---- 光照 ----
  const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
  light.intensity = 0.95

  // ---- 创建 EditorResourceLayer (数据模型) ----
  const resourceTypes = new Map<string, ResourceTypeInfoConfig>([
    ['ore', {
      resourceIndex: 1,
      terrainType: 'Ore',
      allowedTerrainTypes: new Set(['Clear', 'Rough']),
      maxDensity: 10,
    }],
    ['gems', {
      resourceIndex: 2,
      terrainType: 'Gems',
      allowedTerrainTypes: new Set(['Clear']),
      maxDensity: 5,
    }],
    ['tiberium', {
      resourceIndex: 3,
      terrainType: 'Tiberium',
      allowedTerrainTypes: new Set(['Clear', 'Road']),
      maxDensity: 12,
    }],
  ])
  const info = new EditorResourceLayerInfo({ resourceTypes })
  const editorLayer = new EditorResourceLayer(info)
  editorLayer.setResourceValues(new Map([['ore', 20], ['gems', 50], ['tiberium', 30]]))

  // ---- 创建网格 meshes ----
  /** cellMeshMap: "col_row" → AbstractMesh */
  const cellMeshMap = new Map<string, AbstractMesh>()
  /** cellMaterialMap: "col_row" → StandardMaterial */
  const cellMaterialMap = new Map<string, StandardMaterial>()

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const { x, z } = gridToWorld(col, row)
      const meshName = `${CELL_MESH_PREFIX}${col}_${row}`

      const mesh = MeshBuilder.CreatePlane(
        meshName,
        { width: CELL_SIZE * 0.94, height: CELL_SIZE * 0.94 },
        scene,
      )
      mesh.position.set(x, GRID_Y, z)
      mesh.rotation.x = -Math.PI / 2  // 平放在 XZ 平面上
      mesh.receiveShadows = false

      const mat = new StandardMaterial(`mat_${meshName}`, scene)
      mat.diffuseColor = GROUND_COLOR.clone()
      mat.specularColor.set(0, 0, 0)
      mat.backFaceCulling = false
      mesh.material = mat

      const key = `${col}_${row}`
      cellMeshMap.set(key, mesh)
      cellMaterialMap.set(key, mat)
    }
  }

  // ---- 创建地面底座 (用于深度参考) ----
  const basePlane = MeshBuilder.CreatePlane(
    'baseGround',
    { width: GRID_COLS * CELL_SIZE, height: GRID_ROWS * CELL_SIZE },
    scene,
  )
  basePlane.position.set(0, -0.01, 0)
  basePlane.rotation.x = -Math.PI / 2
  const baseMat = new StandardMaterial('baseMat', scene)
  baseMat.diffuseColor = new Color3(0.12, 0.12, 0.15)
  baseMat.specularColor.set(0, 0, 0)
  baseMat.backFaceCulling = false
  basePlane.material = baseMat

  // ---- 悬停高亮 ----
  let hoveredCellKey: string | null = null

  function clearHighlight(): void {
    if (hoveredCellKey) {
      const mat = cellMaterialMap.get(hoveredCellKey)
      if (mat) {
        mat.emissiveColor.set(0, 0, 0)
      }
      hoveredCellKey = null
    }
  }

  function highlightCell(key: string): void {
    if (hoveredCellKey === key) return
    clearHighlight()
    const mat = cellMaterialMap.get(key)
    if (mat) {
      mat.emissiveColor = new Color3(0.3, 0.3, 0.3)
      hoveredCellKey = key
    }
  }

  // ---- 更新 cell 视觉颜色 ----
  function updateCellVisual(col: number, row: number): void {
    const key = `${col}_${row}`
    const mat = cellMaterialMap.get(key)
    if (!mat) return

    const cell = gridToCPos(col, row)
    const density = editorLayer.getDensity(cell)  // 0-100
    const resource = editorLayer.getResource(cell)

    if (resource.type && density > 0) {
      const fullColor = RESOURCE_COLORS[resource.type] ?? GROUND_COLOR
      const t = density / 100
      const color = lerpColor3(GROUND_COLOR, fullColor, t)
      mat.diffuseColor = color

      // 保持悬停高亮
      if (hoveredCellKey === key) {
        mat.emissiveColor = new Color3(0.3, 0.3, 0.3)
      } else {
        mat.emissiveColor.set(0, 0, 0)
      }
    } else {
      mat.diffuseColor = GROUND_COLOR.clone()
      mat.emissiveColor.set(0, 0, 0)
    }
  }

  /** 刷新所有 cell 的视觉表现 */
  function refreshAllCells(): void {
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        updateCellVisual(col, row)
      }
    }
    updateInfoStats()
  }

  /** 更新信息栏统计数据 */
  function updateInfoStats(): void {
    infoPaintedCells.textContent = String(editorLayer.getCellCount())
    infoNetWorth.textContent = String(editorLayer.netWorth)
  }

  // ---- 笔刷绘制逻辑 ----
  let currentResourceType = 'ore'
  let brushDensity = 50  // 0-100
  let brushSize = 1      // 1, 2, 3
  let eraserMode = false
  let resourceVisible = true

  /** 获取当前资源类型对应的 absolute density 值 (而非百分比) */
  function getAbsoluteDensity(percentDensity: number): number {
    const maxDensity = RESOURCE_MAX_DENSITY[currentResourceType] ?? 10
    return Math.max(1, Math.round((percentDensity / 100) * maxDensity))
  }

  /** 在网格 cell 上绘制/擦除资源 */
  function paintCellAt(col: number, row: number): void {
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return

    const cell = gridToCPos(col, row)

    if (eraserMode) {
      // 橡皮擦：清除该 cell 的资源
      const existing = editorLayer.getResource(cell)
      if (existing.type) {
        editorLayer.removeResource(existing.type, cell, existing.density)
      }
    } else {
      // 绘制模式
      const absDensity = getAbsoluteDensity(brushDensity)
      editorLayer.addResource(currentResourceType, cell, absDensity)
    }

    updateCellVisual(col, row)
    updateInfoStats()
  }

  /** 笔刷绘制：以 (centerCol, centerRow) 为中心，绘制 brushSize × brushSize 区域 */
  function brushPaintAt(centerCol: number, centerRow: number): void {
    const half = Math.floor(brushSize / 2)
    for (let dr = -half; dr <= half; dr++) {
      for (let dc = -half; dc <= half; dc++) {
        if (brushSize === 1 && (dr !== 0 || dc !== 0)) continue
        paintCellAt(centerCol + dc, centerRow + dr)
      }
    }
  }

  // ---- 指针交互 ----
  let isPointerDown = false

  scene.onPointerObservable.add((pointerInfo: PointerInfo) => {
    const { type, event } = pointerInfo

    switch (type) {
      case 1: { // POINTERDOWN
        isPointerDown = true
        const pick = scene.pick(event.offsetX, event.offsetY)
        if (pick?.hit && pick.pickedMesh) {
          const grid = parseCellMeshName(pick.pickedMesh.name)
          if (grid) {
            brushPaintAt(grid.col, grid.row)
          }
        }
        break
      }
      case 2: { // POINTERUP
        isPointerDown = false
        break
      }
      case 3: { // POINTERMOVE
        const pick = scene.pick(event.offsetX, event.offsetY)
        if (pick?.hit && pick.pickedMesh) {
          const grid = parseCellMeshName(pick.pickedMesh.name)
          if (grid) {
            const key = `${grid.col}_${grid.row}`
            highlightCell(key)

            if (resourceVisible) {
              const cell = gridToCPos(grid.col, grid.row)
              const contents = editorLayer.getResource(cell)
              if (contents.type) {
                const hex = RESOURCE_COLORS_HEX[contents.type] ?? '???'
                hoverCellInfo.textContent = `悬停: (${grid.col},${grid.row}) ${contents.type} density=${contents.density} color=${hex}`
              } else {
                hoverCellInfo.textContent = `悬停: (${grid.col},${grid.row}) 空`
              }
            } else {
              hoverCellInfo.textContent = `悬停: (${grid.col},${grid.row}) [资源层已隐藏]`
            }

            // 拖拽绘制
            if (isPointerDown) {
              brushPaintAt(grid.col, grid.row)
            }
          } else {
            clearHighlight()
            hoverCellInfo.textContent = '悬停: -'
          }
        } else {
          clearHighlight()
          hoverCellInfo.textContent = '悬停: -'
        }
        break
      }
    }
  })

  // ---- UI 控件绑定 ----
  const resourceTypeSelect = document.getElementById('resource-type') as HTMLSelectElement
  const brushDensitySlider = document.getElementById('brush-density') as HTMLInputElement
  const brushDensityVal = document.getElementById('brush-density-val')!
  const brushSizeSelect = document.getElementById('brush-size') as HTMLSelectElement
  const eraserModeCb = document.getElementById('eraser-mode') as HTMLInputElement
  const btnReset = document.getElementById('btn-reset') as HTMLButtonElement
  const btnShowHide = document.getElementById('btn-showhide') as HTMLButtonElement
  const btnPreset = document.getElementById('btn-preset') as HTMLButtonElement
  const currentColorSwatch = document.getElementById('current-color-swatch')!
  const currentColorHex = document.getElementById('current-color-hex')!

  function updateCurrentColorDisplay(): void {
    const hex = RESOURCE_COLORS_HEX[currentResourceType] ?? '#FFFFFF'
    currentColorSwatch.style.background = hex
    currentColorHex.textContent = hex
  }

  resourceTypeSelect.addEventListener('change', () => {
    currentResourceType = resourceTypeSelect.value
    updateCurrentColorDisplay()
  })

  brushDensitySlider.addEventListener('input', () => {
    brushDensity = parseInt(brushDensitySlider.value, 10)
    brushDensityVal.textContent = `${brushDensity}%`
  })

  brushSizeSelect.addEventListener('change', () => {
    brushSize = parseInt(brushSizeSelect.value, 10)
  })

  eraserModeCb.addEventListener('change', () => {
    eraserMode = eraserModeCb.checked
  })

  btnReset.addEventListener('click', () => {
    editorLayer.clearAllResources()
    refreshAllCells()
    clearHighlight()
    hoverCellInfo.textContent = '悬停: -'
  })

  btnShowHide.addEventListener('click', () => {
    resourceVisible = !resourceVisible
    if (resourceVisible) {
      btnShowHide.textContent = '隐藏资源层 (Toggle Visibility)'
      btnShowHide.classList.remove('active')
      refreshAllCells()
    } else {
      btnShowHide.textContent = '显示资源层 (Toggle Visibility)'
      btnShowHide.classList.add('active')
      // 隐藏资源：所有 cell 恢复地面颜色
      for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
          const key = `${col}_${row}`
          const mat = cellMaterialMap.get(key)
          if (mat) {
            mat.diffuseColor = GROUND_COLOR.clone()
            mat.emissiveColor.set(0, 0, 0)
          }
        }
      }
      hoveredCellKey = null
    }
    updateInfoStats()
  })

  btnPreset.addEventListener('click', () => {
    editorLayer.clearAllResources()

    // 预置场景：创建多种资源类型的图案用于可视化验证
    // Row 0: Ore 密度渐变 10%→100%
    for (let col = 0; col < GRID_COLS; col++) {
      const cell = gridToCPos(col, 0)
      const absDensity = Math.max(1, Math.round(((col + 1) / GRID_COLS) * RESOURCE_MAX_DENSITY['ore']))
      editorLayer.addResource('ore', cell, absDensity)
    }

    // Row 1: Gems 密度渐变 20%→100%
    for (let col = 0; col < GRID_COLS; col++) {
      const cell = gridToCPos(col, 1)
      const absDensity = Math.max(1, Math.round(((col + 1) / GRID_COLS) * RESOURCE_MAX_DENSITY['gems']))
      editorLayer.addResource('gems', cell, absDensity)
    }

    // Row 2: Tiberium 密度渐变
    for (let col = 0; col < GRID_COLS; col++) {
      const cell = gridToCPos(col, 2)
      const absDensity = Math.max(1, Math.round(((col + 1) / GRID_COLS) * RESOURCE_MAX_DENSITY['tiberium']))
      editorLayer.addResource('tiberium', cell, absDensity)
    }

    // Row 3-4: 混合棋盘格图案
    for (let row = 3; row <= 4; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const cell = gridToCPos(col, row)
        const type = (col + row) % 3 === 0 ? 'ore' : (col + row) % 3 === 1 ? 'gems' : 'tiberium'
        const absDensity = Math.round(RESOURCE_MAX_DENSITY[type] * 0.7)
        editorLayer.addResource(type, cell, absDensity)
      }
    }

    // Row 5-6: 3×3 块状图案 (测试笔刷效果)
    // In preset, leave some cells empty for manual brush testing
    for (let row = 5; row <= 6; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        if (col < 5) {
          const cell = gridToCPos(col, row)
          editorLayer.addResource('ore', cell, RESOURCE_MAX_DENSITY['ore'])
        }
        // col >= 5 留空
      }
    }

    // Row 7: 不同密度的 Ore 测试带
    const testDensities = [1, 3, 5, 7, 10]
    for (let col = 0; col < GRID_COLS; col++) {
      const cell = gridToCPos(col, 7)
      const d = testDensities[Math.min(col, testDensities.length - 1)]
      editorLayer.addResource('ore', cell, d)
    }

    refreshAllCells()
  })

  // ---- __testHarness (暴露到 window 以供外部脚本/测试调用) ----
  const testHarness = {
    /** 选择资源类型 */
    selectResource(type: string): void {
      if (RESOURCE_COLORS[type]) {
        currentResourceType = type
        resourceTypeSelect.value = type
        updateCurrentColorDisplay()
      }
    },

    /** 在指定 cell 绘制资源 (col, row 为网格坐标, density 为百分比 0-100) */
    paintCell(col: number, row: number, density: number): void {
      if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return
      const cell = gridToCPos(col, row)
      const absDensity = Math.max(1, Math.round((density / 100) * (RESOURCE_MAX_DENSITY[currentResourceType] ?? 10)))
      editorLayer.addResource(currentResourceType, cell, absDensity)
      updateCellVisual(col, row)
      updateInfoStats()
    },

    /** 获取指定 cell 的资源密度百分比 (0-100) */
    getCellDensity(col: number, row: number): number {
      const cell = gridToCPos(col, row)
      return editorLayer.getDensity(cell)
    },

    /** 获取指定 cell 的当前显示颜色 (HEX) */
    getResourceColor(col: number, row: number): string {
      const cell = gridToCPos(col, row)
      const resource = editorLayer.getResource(cell)
      if (!resource.type) return '#333333'
      const density = editorLayer.getDensity(cell)
      const fullColor = RESOURCE_COLORS[resource.type] ?? GROUND_COLOR
      const t = density / 100
      const color = lerpColor3(GROUND_COLOR, fullColor, t)
      return color3ToHex(color)
    },

    /** 重置所有资源 */
    reset(): void {
      editorLayer.clearAllResources()
      refreshAllCells()
    },

    /** 获取 EditorResourceLayer 实例 (高级用例) */
    getLayer(): EditorResourceLayer {
      return editorLayer
    },
  }

  ;(window as any).__testHarness = testHarness

  // ---- 初始化 ----
  updateCurrentColorDisplay()
  refreshAllCells()

  // 加载预置场景以便立即看到效果
  btnPreset.click()

  // ---- FPS 监控 + 渲染循环 ----
  let fpsFrames = 0
  let fpsAccum = 0
  let fpsDisplay = 0
  let lastFpsUpdate = performance.now()

  scene.onBeforeRenderObservable.add(() => {
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
    infoFrameTime.textContent = fpsDisplay > 0
      ? `${(1000 / fpsDisplay).toFixed(1)}ms`
      : '-'
    infoTime.textContent = new Date().toISOString()
  })

  engine.runRenderLoop(() => {
    scene.render()
  })

  const resizeObserver = new ResizeObserver(() => {
    engine.resize()
    const rect = sandboxEl.getBoundingClientRect()
    const orthoSizeH = Math.max(GRID_COLS, GRID_ROWS) * 0.7
    camera.orthoTop = orthoSizeH
    camera.orthoBottom = -orthoSizeH
    camera.orthoLeft = -orthoSizeH * (rect.width / Math.max(rect.height, 1))
    camera.orthoRight = orthoSizeH * (rect.width / Math.max(rect.height, 1))
  })
  resizeObserver.observe(canvas)

  console.log('[resource-paint] Test harness initialized. Access via window.__testHarness')
  console.log('[resource-paint] APIs: selectResource(type), paintCell(col,row,density%), getCellDensity(col,row), getResourceColor(col,row), reset()')
}

main().catch((err: unknown) => {
  console.error('[fatal] main() failed:', err)
  const errorEl = document.getElementById('gpu-error')!
  errorEl.style.display = 'flex'
  errorEl.textContent = `初始化失败: ${err instanceof Error ? err.message : String(err)}`
})
