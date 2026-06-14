/**
 * main.ts — ResourceRenderer 资源颜色映射与变体对比 人工验收测试
 *
 * 测试目标:
 *   1. 验证不同资源类型（Tiberium, Ore, Spice, Gems）使用正确的颜色渲染
 *   2. 验证每种资源类型的多个变体在颜色上有可分辨差异
 *   3. 验证密度从 1 到 maxDensity 的颜色渐变平滑且正确
 *   4. 验证调色板颜色偏移是否准确（变体色相偏移 < 30 度）
 *
 * OpenRA 对照: ResourceRenderer.ts
 *   - ResourceRendererInfo.resourceTypes (palette/image/sequences/name)
 *   - _chooseVariant() → 确定性变体选择
 *   - _updateRenderedSprite() → 密度驱动帧选择
 *
 * 本测试页使用 Babylon.js SPS 将每种资源类型渲染为独立面板。
 * 每个面板包含全部密度级别（1~maxDensity）和全部变体的可见对比。
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
// 资源类型定义 — 精确颜色映射
// ---------------------------------------------------------------------------

interface ResourceTypeConfig {
  name: string
  /** 最小密度颜色 (density=1) */
  minColor: [number, number, number]
  /** 最大密度颜色 (density=max) */
  maxColor: [number, number, number]
  /** 变体数 */
  numVariants: number
  /** 变体色相偏移量（度） */
  variantHueShift: number
}

const RESOURCE_TYPES: ResourceTypeConfig[] = [
  {
    name: 'Tiberium',
    minColor: [0.05, 0.25, 0.08],
    maxColor: [0.00, 0.80, 0.27],
    numVariants: 4,
    variantHueShift: 15,
  },
  {
    name: 'Ore',
    minColor: [0.20, 0.12, 0.02],
    maxColor: [0.85, 0.65, 0.13],
    numVariants: 4,
    variantHueShift: 12,
  },
  {
    name: 'Spice',
    minColor: [0.18, 0.08, 0.01],
    maxColor: [0.80, 0.33, 0.00],
    numVariants: 3,
    variantHueShift: 20,
  },
  {
    name: 'Gems',
    minColor: [0.15, 0.02, 0.15],
    maxColor: [0.80, 0.27, 0.80],
    numVariants: 4,
    variantHueShift: 10,
  },
]

// ---------------------------------------------------------------------------
// 颜色工具
// ---------------------------------------------------------------------------

/** 密度插值颜色 */
function lerpColor(
  minColor: [number, number, number],
  maxColor: [number, number, number],
  density: number,
  maxDensity: number,
): [number, number, number] {
  const t = Math.max(0, Math.min(1, (density - 1) / (maxDensity - 1)))
  return [
    minColor[0] + (maxColor[0] - minColor[0]) * t,
    minColor[1] + (maxColor[1] - minColor[1]) * t,
    minColor[2] + (maxColor[2] - minColor[2]) * t,
  ]
}

/** HSL → RGB（用于变体偏移） */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360
  s = Math.max(0, Math.min(1, s))
  l = Math.max(0, Math.min(1, l))
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = l - c / 2
  let r: number, g: number, b: number
  if (h < 60) { r = c; g = x; b = 0 }
  else if (h < 120) { r = x; g = c; b = 0 }
  else if (h < 180) { r = 0; g = c; b = x }
  else if (h < 240) { r = 0; g = x; b = c }
  else if (h < 300) { r = x; g = 0; b = c }
  else { r = c; g = 0; b = x }
  return [r + m, g + m, b + m]
}

/** RGB → HSL */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6 * 360
  else if (max === g) h = ((b - r) / d + 2) / 6 * 360
  else h = ((r - g) / d + 4) / 6 * 360
  return [h, s, l]
}

/** 应用变体色相偏移 */
function variantColor(
  base: [number, number, number],
  variantIdx: number,
  numVariants: number,
  hueShiftDeg: number,
): [number, number, number] {
  if (numVariants <= 1) return base
  const [h, s, l] = rgbToHsl(base[0], base[1], base[2])
  const offset = (variantIdx - (numVariants - 1) / 2) / numVariants * hueShiftDeg * 2
  return hslToRgb(h + offset, s, l)
}

/** RGB → hex 字符串 */
function rgbToHex(r: number, g: number, b: number): string {
  const hr = Math.round(Math.max(0, Math.min(1, r)) * 255).toString(16).padStart(2, '0')
  const hg = Math.round(Math.max(0, Math.min(1, g)) * 255).toString(16).padStart(2, '0')
  const hb = Math.round(Math.max(0, Math.min(1, b)) * 255).toString(16).padStart(2, '0')
  return `#${hr}${hg}${hb}`
}

// ---------------------------------------------------------------------------
// 布局模式
// ---------------------------------------------------------------------------

type LayoutMode = 'grid' | 'side-by-side' | 'density-wheels'

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
    18,
    new Vector3(0, 0, 0),
    scene,
  )
  camera.lowerRadiusLimit = 4
  camera.upperRadiusLimit = 40
  camera.lowerBetaLimit = 0.1
  camera.upperBetaLimit = Math.PI / 2.2
  camera.attachControl(canvas, true)

  // ---- 光照 ----
  const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
  light.intensity = 0.7

  // ---- 状态变量 ----
  let maxDensity = 10
  let layoutMode: LayoutMode = 'grid'
  let showLabels = true

  // SPS
  let sps: SolidParticleSystem | null = null

  // ---- UI 引用 ----
  const layoutModeSel = document.getElementById('layout-mode') as HTMLSelectElement
  const maxDensitySel = document.getElementById('max-density') as HTMLSelectElement
  const btnToggleLabels = document.getElementById('btn-toggle-labels') as HTMLButtonElement
  const btnComparePalettes = document.getElementById('btn-compare-palettes') as HTMLButtonElement
  const btnResetView = document.getElementById('btn-reset-view') as HTMLButtonElement

  // ---- 更新颜色图例 ----
  function updateLegends(): void {
    const panels = [
      { id: 'legend-tib-rows', config: RESOURCE_TYPES[0]! },
      { id: 'legend-ore-rows', config: RESOURCE_TYPES[1]! },
      { id: 'legend-spice-rows', config: RESOURCE_TYPES[2]! },
      { id: 'legend-gems-rows', config: RESOURCE_TYPES[3]! },
    ]

    for (const { id, config } of panels) {
      const el = document.getElementById(id)!
      let html = ''
      const densities = [1, Math.ceil(maxDensity / 3), Math.ceil(maxDensity * 2 / 3), maxDensity]
      for (const d of densities) {
        const base = lerpColor(config.minColor, config.maxColor, d, maxDensity)
        for (let v = 0; v < config.numVariants; v++) {
          const vc = variantColor(base, v, config.numVariants, config.variantHueShift)
          const hex = rgbToHex(vc[0], vc[1], vc[2])
          html += `<div class="legend-row"><span class="swatch" style="background:${hex};"></span>D${d} V${v} ${hex}</div>`
        }
      }
      el.innerHTML = html
    }
  }

  // ---- 构建场景 ----
  function buildScene(): void {
    if (sps) {
      sps.dispose()
      sps = null
    }

    const totalParticles = calculateTotalParticles()

    const shapeMesh = MeshBuilder.CreatePlane('shape', { width: 1, height: 1 }, scene)
    shapeMesh.isVisible = false

    sps = new SolidParticleSystem('colorMapSPS', scene, { updatable: true })
    sps.addShape(shapeMesh, totalParticles)
    shapeMesh.dispose()

    const spsMesh = sps.buildMesh()
    const mat = new StandardMaterial('mat', scene)
    mat.emissiveColor = new Color3(1, 1, 1)
    mat.specularColor.set(0, 0, 0)
    mat.disableLighting = true
    mat.backFaceCulling = false
    spsMesh.material = mat

    layoutParticles()
    sps.setParticles()
    updateLegends()
  }

  function calculateTotalParticles(): number {
    let count = 0
    for (const config of RESOURCE_TYPES) {
      if (layoutMode === 'density-wheels') {
        // 每个密度级别 * 变体数
        count += maxDensity * config.numVariants
      } else {
        // 每个类型: 密度梯度行 (maxDensity 列) × 变体行 = 密度 × 变体
        count += maxDensity * config.numVariants
      }
    }
    return count
  }

  function layoutParticles(): void {
    if (!sps) return

    const cellSize = 0.9
    const panelGap = 2.5

    if (layoutMode === 'grid' || layoutMode === 'side-by-side') {
      const colsPerPanel = maxDensity
      // 每个类型的面板宽 = maxDensity 列
      let particleIndex = 0

      for (let typeIdx = 0; typeIdx < RESOURCE_TYPES.length; typeIdx++) {
        const config = RESOURCE_TYPES[typeIdx]!
        const panelX = typeIdx % 2 === 0
          ? (typeIdx / 2) * (colsPerPanel * cellSize + panelGap)
          : ((typeIdx - 1) / 2) * (colsPerPanel * cellSize + panelGap)
        // side-by-side: 2 列面板布局
        const panelZ = typeIdx % 2 === 0 ? 0 : -(config.numVariants * cellSize + 1)

        const actualCols = colsPerPanel
        const offsetX = panelX - (RESOURCE_TYPES.length > 2 ? actualCols * cellSize * 0.65 : 0)
        const offsetZ = panelZ

        // 放置粒子：行 = 变体，列 = 密度
        for (let variant = 0; variant < config.numVariants; variant++) {
          for (let density = 1; density <= maxDensity; density++) {
            if (particleIndex >= sps!.nbParticles) continue
            const p = sps!.particles[particleIndex]!
            const col = density - 1
            const row = variant

            const x = offsetX + col * cellSize
            const z = offsetZ + row * cellSize

            p.position.set(x, 0, z)
            p.rotation.x = -Math.PI / 2
            p.scaling.set(cellSize * 0.85, cellSize * 0.85, 1)

            const base = lerpColor(config.minColor, config.maxColor, density, maxDensity)
            const vc = variantColor(base, variant, config.numVariants, config.variantHueShift)
            p.color = new Color4(vc[0], vc[1], vc[2], 1)

            particleIndex++
          }
        }
      }
    }

    // density-wheels: 圆形排列
    if (layoutMode === 'density-wheels') {
      const wheelRadius = 3.5
      const wheelGap = 9
      let particleIndex = 0

      for (let typeIdx = 0; typeIdx < RESOURCE_TYPES.length; typeIdx++) {
        const config = RESOURCE_TYPES[typeIdx]!
        const centerX = (typeIdx % 2) * wheelGap - 4
        const centerZ = Math.floor(typeIdx / 2) * wheelGap - 4

        for (let density = 1; density <= maxDensity; density++) {
          const t = (density - 1) / (maxDensity - 1)
          const ringRadius = wheelRadius * t
          const numInRing = config.numVariants

          for (let variant = 0; variant < numInRing; variant++) {
            if (particleIndex >= sps!.nbParticles) continue
            const p = sps!.particles[particleIndex]!
            const angle = (variant / numInRing) * Math.PI * 2
            const x = centerX + ringRadius * Math.cos(angle)
            const z = centerZ + ringRadius * Math.sin(angle)

            p.position.set(x, (t - 0.5) * 2, z)
            p.rotation.x = -Math.PI / 2

            const scaleFac = 0.3 + t * 0.7
            p.scaling.set(scaleFac, scaleFac, 1)

            const base = lerpColor(config.minColor, config.maxColor, density, maxDensity)
            const vc = variantColor(base, variant, config.numVariants, config.variantHueShift)
            p.color = new Color4(vc[0], vc[1], vc[2], 1)

            particleIndex++
          }
        }
      }
    }
  }

  // ---- 切换标签 ----
  function toggleLabels(): void {
    showLabels = !showLabels
    btnToggleLabels.textContent = showLabels ? '隐藏标签' : '显示标签'
    // 对于 SPS 模拟，标签通过图例面板体现
  }

  // ---- 事件处理 ----
  layoutModeSel.addEventListener('change', () => {
    layoutMode = layoutModeSel.value as LayoutMode
    buildScene()
  })

  maxDensitySel.addEventListener('change', () => {
    maxDensity = parseInt(maxDensitySel.value, 10)
    buildScene()
  })

  btnToggleLabels.addEventListener('click', toggleLabels)

  btnComparePalettes.addEventListener('click', () => {
    // 切换：显示原始颜色 vs 变体偏移颜色
    if (!sps) return
    const current = btnComparePalettes.textContent
    if (current.includes('原色 vs 偏移')) {
      btnComparePalettes.textContent = '显示原始颜色'
      btnComparePalettes.style.background = '#e94560'
      btnComparePalettes.style.color = '#fff'
      // 临时将所有变体设为相同颜色（仅显示密度渐变）
      let particleIndex = 0
      for (const config of RESOURCE_TYPES) {
        for (let variant = 0; variant < config.numVariants; variant++) {
          for (let density = 1; density <= maxDensity; density++) {
            if (particleIndex >= sps.nbParticles) break
            const p = sps.particles[particleIndex]!
            const base = lerpColor(config.minColor, config.maxColor, density, maxDensity)
            // 不做变体偏移
            p.color = new Color4(base[0], base[1], base[2], 1)
            particleIndex++
          }
        }
      }
      sps.setParticles()
    } else {
      btnComparePalettes.textContent = '比较调色板 (原色 vs 偏移)'
      btnComparePalettes.style.background = ''
      btnComparePalettes.style.color = ''
      buildScene()
    }
  })

  btnResetView.addEventListener('click', () => {
    camera.alpha = -Math.PI / 2
    camera.beta = Math.PI / 4
    camera.radius = 18
    camera.target.set(0, 0, 0)
    buildScene()
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
  buildScene()
}

main().catch((err: unknown) => {
  console.error('[fatal] main() failed:', err)
  const errorEl = document.getElementById('gpu-error')!
  errorEl.style.display = 'flex'
  errorEl.textContent = `初始化失败: ${err instanceof Error ? err.message : String(err)}`
})
