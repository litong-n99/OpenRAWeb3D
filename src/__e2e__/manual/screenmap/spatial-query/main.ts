/**
 * main.ts -- ScreenMap 空间查询与选择框人工验收测试
 *
 * 测试目标:
 *   1. 验证 ScreenMap 的分区网格 (bin grid) 空间索引
 *   2. 验证 ActorsInMouseBox (矩形框选) 正确检测相交单元
 *   3. 验证 ActorsAtMouse (精确点击) 仅命中鼠标下的单元
 *   4. 验证 bin 大小变化对查询精度的影响
 *
 * OpenRA 对照: ScreenMap.ts
 * - SpatiallyPartitioned<T> 空间哈希网格
 * - ActorsInMouseBox(Rectangle) → ActorBoundsPair[]
 * - ActorsAtMouse(int2) → ActorBoundsPair[]
 * - binSize 配置参数 (默认 250px)
 *
 * 2D→3D 映射: 本测试在 3D 场景中使用相同的 2D 空间索引概念，
 * 通过正交投影 (orthographic) 将 XZ 平面映射到屏幕坐标。
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
import { Matrix } from '@babylonjs/core'
import { Tools } from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Unit 数据结构 — 模拟 Actor 的空间索引条目
// ---------------------------------------------------------------------------

interface Unit {
  node: TransformNode
  mesh: Mesh
  /** 包围盒在世界 XZ 平面上的宽度 (对应 ScreenBounds 宽度的一半) */
  halfWidth: number
  /** 包围盒在世界 XZ 平面上的高度 (对应 ScreenBounds 高度的一半) */
  halfHeight: number
  /** 命中测试多边形顶点 (XZ 平面, 相对于 node 中心) */
  hitPoly: readonly { x: number; z: number }[]
  selected: boolean
  hovered: boolean
}

// ---------------------------------------------------------------------------
// 空间哈希网格 (模拟 SpatiallyPartitioned<T>)
// ---------------------------------------------------------------------------

interface GridCell {
  units: Unit[]
}

class SpatialGrid {
  readonly worldWidth: number
  readonly worldHeight: number
  readonly binSize: number
  readonly cols: number
  readonly rows: number
  readonly cells: GridCell[]

  constructor(
    worldWidth: number,
    worldHeight: number,
    binSize: number,
  ) {
    this.worldWidth = worldWidth
    this.worldHeight = worldHeight
    this.binSize = binSize
    this.cols = Math.ceil(worldWidth / binSize)
    this.rows = Math.ceil(worldHeight / binSize)
    this.cells = new Array(this.cols * this.rows)
    for (let i = 0; i < this.cells.length; i++) {
      this.cells[i] = { units: [] }
    }
  }

  clear(): void {
    for (const cell of this.cells) {
      cell.units.length = 0
    }
  }

  private worldXToCol(x: number): number {
    return Math.floor((x + this.worldWidth / 2) / this.binSize)
  }

  private worldZToRow(z: number): number {
    return Math.floor((z + this.worldHeight / 2) / this.binSize)
  }

  /** 将 Unit 注册到网格 */
  insert(unit: Unit): void {
    const col = this.worldXToCol(unit.node.position.x)
    const row = this.worldZToRow(unit.node.position.z)
    if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
      this.cells[row * this.cols + col].units.push(unit)
    }
  }

  /** 框选查询: 返回包围盒与矩形相交的所有 Unit */
  queryRect(
    x1: number, z1: number,
    x2: number, z2: number,
  ): Unit[] {
    const minX = Math.min(x1, x2)
    const maxX = Math.max(x1, x2)
    const minZ = Math.min(z1, z2)
    const maxZ = Math.max(z1, z2)

    const col0 = Math.max(0, this.worldXToCol(minX))
    const col1 = Math.min(this.cols - 1, this.worldXToCol(maxX))
    const row0 = Math.max(0, this.worldZToRow(minZ))
    const row1 = Math.min(this.rows - 1, this.worldZToRow(maxZ))

    const result: Unit[] = []
    const seen = new Set<Unit>()
    for (let r = row0; r <= row1; r++) {
      for (let c = col0; c <= col1; c++) {
        for (const unit of this.cells[r * this.cols + c].units) {
          if (seen.has(unit)) continue
          seen.add(unit)
          const ux = unit.node.position.x
          const uz = unit.node.position.z
          if (
            ux + unit.halfWidth >= minX &&
            ux - unit.halfWidth <= maxX &&
            uz + unit.halfHeight >= minZ &&
            uz - unit.halfHeight <= maxZ
          ) {
            result.push(unit)
          }
        }
      }
    }
    return result
  }

  /** 精确点击查询: 返回包含指定点的 Unit */
  queryPoint(worldX: number, worldZ: number): Unit[] {
    const col = this.worldXToCol(worldX)
    const row = this.worldZToRow(worldZ)
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return []

    const result: Unit[] = []
    for (const unit of this.cells[row * this.cols + col].units) {
      const ux = unit.node.position.x
      const uz = unit.node.position.z
      if (
        Math.abs(worldX - ux) <= unit.halfWidth &&
        Math.abs(worldZ - uz) <= unit.halfHeight
      ) {
        result.push(unit)
      }
    }
    return result
  }
}

// ---------------------------------------------------------------------------
// Unit 包围盒可视化 Line
// ---------------------------------------------------------------------------

function createBoundsLines(
  unit: Unit,
  scene: Scene,
  color: Color3,
  yOffset: number,
): Mesh {
  const cx = unit.node.position.x
  const cz = unit.node.position.z
  const hw = unit.halfWidth
  const hh = unit.halfHeight
  const lines = MeshBuilder.CreateLines(`bounds_${unit.node.name}`, {
    points: [
      new Vector3(cx - hw, yOffset, cz - hh),
      new Vector3(cx + hw, yOffset, cz - hh),
      new Vector3(cx + hw, yOffset, cz + hh),
      new Vector3(cx - hw, yOffset, cz + hh),
      new Vector3(cx - hw, yOffset, cz - hh),
    ],
  }, scene)
  lines.color = color
  return lines
}

// ---------------------------------------------------------------------------
// 诊断工具: 结构化日志前缀
// ---------------------------------------------------------------------------

const DIAG_PREFIX = '[screenmap]'

let eventSeq = 0
function nextSeq(): number {
  return ++eventSeq
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
  const sandboxEl = document.getElementById('sandbox')!
  const canvas = document.createElement('canvas')
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  // Prevent browser focus outline (CSS handles visual, this prevents focus ring)
  canvas.tabIndex = -1
  canvas.width = Math.max(sandboxEl.getBoundingClientRect().width || 800, 1)
  canvas.height = Math.max(sandboxEl.getBoundingClientRect().height || 600, 1)
  sandboxEl.appendChild(canvas)

  // ---- 诊断: canvas 初始化后的尺寸 ----
  console.group(`${DIAG_PREFIX} Initial Canvas Setup`)
  console.log(`${DIAG_PREFIX} canvas.width (attribute): ${canvas.width}`)
  console.log(`${DIAG_PREFIX} canvas.height (attribute): ${canvas.height}`)
  console.log(`${DIAG_PREFIX} canvas.style.width: ${canvas.style.width}`)
  console.log(`${DIAG_PREFIX} canvas.style.height: ${canvas.style.height}`)
  console.log(`${DIAG_PREFIX} canvas.tabIndex: ${canvas.tabIndex}`)
  console.log(`${DIAG_PREFIX} sandboxEl.getBoundingClientRect(): w=${sandboxEl.getBoundingClientRect().width}, h=${sandboxEl.getBoundingClientRect().height}`)
  console.groupEnd()

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
    'cam', -Math.PI / 4, Math.PI / 4, 25,
    new Vector3(0, 0, 0), scene,
  )
  camera.lowerRadiusLimit = 5
  camera.upperRadiusLimit = 50
  camera.panningSensibility = 500
  scene.activeCamera = camera
  camera.attachControl(canvas, true)

  const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
  light.intensity = 0.9

  // ---- 地面 ----
  const groundMat = new StandardMaterial('ground', scene)
  groundMat.emissiveColor = new Color3(0.10, 0.13, 0.18)
  groundMat.disableLighting = true
  const groundMesh = MeshBuilder.CreateGround('ground', { width: 30, height: 30 }, scene)
  groundMesh.material = groundMat
  groundMesh.position.y = -0.01
  groundMesh.isPickable = true

  // ---- 诊断: Engine 创建后的尺寸 ----
  console.group(`${DIAG_PREFIX} Engine Created`)
  const initRect = canvas.getBoundingClientRect()
  console.log(`${DIAG_PREFIX} canvas.getBoundingClientRect(): ${initRect.width.toFixed(1)} x ${initRect.height.toFixed(1)}, left=${initRect.left.toFixed(1)}, top=${initRect.top.toFixed(1)}`)
  console.log(`${DIAG_PREFIX} canvas.width (attr):  ${canvas.width}`)
  console.log(`${DIAG_PREFIX} canvas.height (attr): ${canvas.height}`)
  console.log(`${DIAG_PREFIX} engine.getRenderWidth():  ${engine.getRenderWidth()}`)
  console.log(`${DIAG_PREFIX} engine.getRenderHeight(): ${engine.getRenderHeight()}`)
  console.log(`${DIAG_PREFIX} engine.getHardwareScalingLevel(): ${engine.getHardwareScalingLevel()}`)
  console.log(`${DIAG_PREFIX} scene.activeCamera: ${scene.activeCamera?.name ?? 'NULL'}`)
  console.log(`${DIAG_PREFIX} scene.cameras.length: ${scene.cameras.length}`)
  console.log(`${DIAG_PREFIX} scene.meshes.length: ${scene.meshes.length}`)
  for (const m of scene.meshes) {
    console.log(`${DIAG_PREFIX}   mesh: name="${m.name}", isPickable=${m.isPickable}, isVisible=${m.isVisible}, isEnabled=${m.isEnabled()}`)
  }
  Tools.Log(`${DIAG_PREFIX} === Setup complete, ready for interaction ===`)
  console.groupEnd()

  // ---- 世界参数 ----
  const WORLD_W = 30
  const WORLD_H = 30

  // ---- Unit 纹理 ----
  const unitColors = [
    new Color3(0.2, 0.6, 0.95),
    new Color3(0.95, 0.33, 0.2),
    new Color3(0.2, 0.85, 0.4),
    new Color3(0.95, 0.75, 0.1),
    new Color3(0.85, 0.3, 0.85),
  ]

  function createUnitTexture(color: Color3, scene: Scene, id: number): DynamicTexture {
    const size = 64
    const tex = new DynamicTexture(`utex_${id}`, { width: size, height: size }, scene, false)
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D
    const r = Math.round(color.r * 255)
    const g = Math.round(color.g * 255)
    const b = Math.round(color.b * 255)
    ctx.fillStyle = `rgb(${r},${g},${b})`
    ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = 'white'
    ctx.font = 'bold 24px "Segoe UI", system-ui'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(id), size / 2, size / 2)
    tex.update(true)
    tex.hasAlpha = true
    return tex
  }

  // ---- 创建 Unit ----
  const units: Unit[] = []
  const unitSize = 1.5

  function spawnUnits(count: number): void {
    for (const u of units) {
      u.mesh.dispose()
      u.node.dispose()
    }
    units.length = 0

    for (let i = 0; i < count; i++) {
      const color = unitColors[i % unitColors.length]
      const tex = createUnitTexture(color, scene, i)
      const mat = new StandardMaterial(`umat_${i}`, scene)
      mat.diffuseTexture = tex
      mat.emissiveTexture = tex
      mat.emissiveColor = Color3.White()
      mat.specularColor.set(0, 0, 0)
      mat.backFaceCulling = false
      mat.disableLighting = true

      const x = (Math.random() - 0.5) * (WORLD_W - 4)
      const z = (Math.random() - 0.5) * (WORLD_H - 4)

      const node = new TransformNode(`unit_${i}`, scene)
      node.position.set(x, 0.05, z)

      const mesh = MeshBuilder.CreateGround(`body_${i}`, { width: unitSize, height: unitSize }, scene)
      mesh.material = mat
      mesh.parent = node
      mesh.position = Vector3.Zero()
      mesh.isPickable = false

      const unit: Unit = {
        node,
        mesh,
        halfWidth: unitSize / 2,
        halfHeight: unitSize / 2,
        hitPoly: [
          { x: -unitSize / 2, z: -unitSize / 2 },
          { x: unitSize / 2, z: -unitSize / 2 },
          { x: unitSize / 2, z: unitSize / 2 },
          { x: -unitSize / 2, z: unitSize / 2 },
        ],
        selected: false,
        hovered: false,
      }
      units.push(unit)
    }
  }

  // ---- 空间网格 ----
  let grid = new SpatialGrid(WORLD_W, WORLD_H, 5)
  let showBounds = true
  let showMouseBounds = false
  let showGrid = false
  let hoverTestEnabled = false
  const boundsLines: Mesh[] = []
  const gridLines: Mesh[] = []

  function clearBoundsLines(): void {
    for (const l of boundsLines) l.dispose()
    boundsLines.length = 0
  }

  function clearGridLines(): void {
    for (const l of gridLines) l.dispose()
    gridLines.length = 0
  }

  function drawGridLines(): void {
    clearGridLines()
    if (!showGrid) return
    const halfW = WORLD_W / 2
    const halfH = WORLD_H / 2
    for (let c = 0; c <= grid.cols; c++) {
      const x = -halfW + c * grid.binSize
      const line = MeshBuilder.CreateLines(`gcol_${c}`, {
        points: [new Vector3(x, 0.01, -halfH), new Vector3(x, 0.01, halfH)],
      }, scene)
      line.color = new Color3(0.2, 0.3, 0.5)
      gridLines.push(line)
    }
    for (let r = 0; r <= grid.rows; r++) {
      const z = -halfH + r * grid.binSize
      const line = MeshBuilder.CreateLines(`grow_${r}`, {
        points: [new Vector3(-halfW, 0.01, z), new Vector3(halfW, 0.01, z)],
      }, scene)
      line.color = new Color3(0.2, 0.3, 0.5)
      gridLines.push(line)
    }
  }

  function drawBoundsLines(): void {
    clearBoundsLines()
    if (!showBounds && !showMouseBounds) return
    for (const unit of units) {
      if (showBounds) {
        const line = createBoundsLines(unit, scene, new Color3(0.3, 0.7, 0.3), 0.03)
        boundsLines.push(line)
      }
      if (showMouseBounds) {
        const cx = unit.node.position.x
        const cz = unit.node.position.z
        const pts = unit.hitPoly.map(p => new Vector3(cx + p.x, 0.04, cz + p.z))
        pts.push(pts[0])
        const line = MeshBuilder.CreateLines(`mb_${unit.node.name}`, { points: pts }, scene)
        line.color = new Color3(0.9, 0.6, 0.2)
        boundsLines.push(line)
      }
    }
  }

  function rebuildGrid(): void {
    grid.clear()
    for (const unit of units) {
      grid.insert(unit)
    }
    drawGridLines()
  }

  function highlightSelected(): void {
    for (const unit of units) {
      const mat = unit.mesh.material as StandardMaterial
      if (unit.selected) {
        mat.emissiveColor = new Color3(0.4, 0.9, 1.0)
      } else if (unit.hovered) {
        mat.emissiveColor = new Color3(0.9, 0.9, 0.3)
      } else {
        mat.emissiveColor = Color3.White()
      }
    }
  }

  // -------------------------------------------------------------------------
  // screenToWorld — 使用 createPickingRay + XZ 平面求交
  // -------------------------------------------------------------------------

  /**
   * 将屏幕像素坐标转换为世界 XZ 平面坐标
   */
  function screenToWorld(
    canvasRect: DOMRect,
    sx: number,
    sy: number,
  ): { x: number; z: number } | null {
    const renderWidth = engine.getRenderWidth()
    const renderHeight = engine.getRenderHeight()
    const scaleX = renderWidth / (canvasRect.width || 1)
    const scaleY = renderHeight / (canvasRect.height || 1)
    const pickX = sx * scaleX
    const pickY = sy * scaleY

    const ray = scene.createPickingRay(
      pickX, pickY,
      Matrix.Identity(),
      camera,
    )

    // 诊断: 输出 ray 详情
    console.log(`${DIAG_PREFIX}   screenToWorld: pickRaw=(${pickX.toFixed(1)}, ${pickY.toFixed(1)}) scale=(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`)
    console.log(`${DIAG_PREFIX}   screenToWorld: ray.origin=(${ray.origin.x.toFixed(2)}, ${ray.origin.y.toFixed(2)}, ${ray.origin.z.toFixed(2)})`)
    console.log(`${DIAG_PREFIX}   screenToWorld: ray.dir=(${ray.direction.x.toFixed(4)}, ${ray.direction.y.toFixed(4)}, ${ray.direction.z.toFixed(4)})`)

    if (Math.abs(ray.direction.y) < 1e-8) {
      console.warn(`${DIAG_PREFIX}   screenToWorld: REJECTED — ray nearly parallel to XZ plane (dir.y=${ray.direction.y.toFixed(8)})`)
      return null
    }

    const t = -ray.origin.y / ray.direction.y
    if (t <= 0) {
      console.warn(`${DIAG_PREFIX}   screenToWorld: REJECTED — intersection behind camera (t=${t.toFixed(3)})`)
      console.warn(`${DIAG_PREFIX}     camera.position.y=${camera.position.y.toFixed(2)}, camera.target.y=${camera.target?.y ?? '?'}`)
      return null
    }

    const wx = ray.origin.x + t * ray.direction.x
    const wz = ray.origin.z + t * ray.direction.z

    const inWorld = wx >= -WORLD_W / 2 && wx <= WORLD_W / 2 && wz >= -WORLD_H / 2 && wz <= WORLD_H / 2
    console.log(`${DIAG_PREFIX}   screenToWorld: HIT → world=(${wx.toFixed(2)}, ${wz.toFixed(2)}) t=${t.toFixed(2)} inWorld=${inWorld}`)

    return { x: wx, z: wz }
  }

  /**
   * 打印完整的 canvas 尺寸诊断信息
   */
  function dumpCanvasDiagnostics(label: string): void {
    const rect = canvas.getBoundingClientRect()
    console.group(`${DIAG_PREFIX} Canvas Dimensions [${label}]`)
    console.log(`${DIAG_PREFIX}   getBoundingClientRect: ${rect.width.toFixed(1)} x ${rect.height.toFixed(1)}, left=${rect.left.toFixed(1)}, top=${rect.top.toFixed(1)}`)
    console.log(`${DIAG_PREFIX}   canvas.width (attr):  ${canvas.width}`)
    console.log(`${DIAG_PREFIX}   canvas.height (attr): ${canvas.height}`)
    console.log(`${DIAG_PREFIX}   canvas.style.width:   ${canvas.style.width}`)
    console.log(`${DIAG_PREFIX}   canvas.style.height:  ${canvas.style.height}`)
    console.log(`${DIAG_PREFIX}   engine.getRenderWidth:  ${engine.getRenderWidth()}`)
    console.log(`${DIAG_PREFIX}   engine.getRenderHeight: ${engine.getRenderHeight()}`)
    console.log(`${DIAG_PREFIX}   window.inner: ${window.innerWidth}x${window.innerHeight}`)
    console.log(`${DIAG_PREFIX}   sandboxEl BCR: ${sandboxEl.getBoundingClientRect().width.toFixed(1)} x ${sandboxEl.getBoundingClientRect().height.toFixed(1)}`)
    console.groupEnd()
  }

  /**
   * 打印所有 unit 的位置和选中状态
   */
  function dumpUnitState(): void {
    console.group(`${DIAG_PREFIX} Unit State`)
    for (let i = 0; i < units.length; i++) {
      const u = units[i]
      console.log(`${DIAG_PREFIX}   [${i}] pos=(${u.node.position.x.toFixed(2)}, ${u.node.position.z.toFixed(2)}) hw=${u.halfWidth} hh=${u.halfHeight} sel=${u.selected} hov=${u.hovered}`)
    }
    console.groupEnd()
  }

  // -------------------------------------------------------------------------
  // 事件处理
  // -------------------------------------------------------------------------

  const selRectEl = document.getElementById('selection-rect')!
  const statSelected = document.getElementById('stat-selected')!
  const overlayEl = document.getElementById('overlay')!

  let isSelecting = false
  let selStartX = 0
  let selStartY = 0
  let selStartWorld: { x: number; z: number } | null = null
  let pickAttempts = 0
  let pickSuccesses = 0

  // ============================================================
  // Pointer 事件 — 业务逻辑主入口
  //
  // 为什么用 pointerdown/pointerup 而不是 mousedown/mouseup:
  //   Babylon.js 在 pointerdown 时调用 setPointerCapture()（见
  //   webDeviceInputSystem.js:434），浏览器建立 pointer capture 后
  //   会抑制兼容性 mouse 事件（mousedown/mouseup 不再派发）。
  //   因此必须使用 pointer 事件来驱动选择逻辑。
  // ============================================================

  canvas.addEventListener('pointerdown', (e) => {
    const seq = nextSeq()
    console.group(`${DIAG_PREFIX} [EVENT #${seq}] pointerdown START`)

    // 只处理左键/主指针的 pointerdown
    if (e.button !== 0) {
      console.log(`${DIAG_PREFIX}   SKIP: button=${e.button} (not left/primary button)`)
      console.groupEnd()
      return
    }

    pickAttempts++
    isSelecting = true
    selStartX = e.clientX
    selStartY = e.clientY

    dumpCanvasDiagnostics(`pointerdown #${pickAttempts}`)

    const canvasRect = canvas.getBoundingClientRect()
    const sx = e.clientX - canvasRect.left
    const sy = e.clientY - canvasRect.top

    console.log(`${DIAG_PREFIX}   pointerdown #${pickAttempts}: pointerId=${e.pointerId} client=(${e.clientX},${e.clientY})`)
    console.log(`${DIAG_PREFIX}   canvasRect: left=${canvasRect.left.toFixed(1)}, top=${canvasRect.top.toFixed(1)}, w=${canvasRect.width.toFixed(1)}, h=${canvasRect.height.toFixed(1)}`)
    console.log(`${DIAG_PREFIX}   CSS relative to canvas: (${sx.toFixed(1)}, ${sy.toFixed(1)})`)

    const pick = screenToWorld(canvasRect, sx, sy)
    selStartWorld = pick

    if (pick) {
      pickSuccesses++
      console.log(`${DIAG_PREFIX}   → pick SUCCESS: world=(${pick.x.toFixed(2)}, ${pick.z.toFixed(2)}) successes=${pickSuccesses}/${pickAttempts}`)

      const pointHits = grid.queryPoint(pick.x, pick.z)
      console.log(`${DIAG_PREFIX}   → Point query preview at this position: ${pointHits.length} unit(s)`)
      for (const h of pointHits) {
        console.log(`${DIAG_PREFIX}     ${h.node.name} at (${h.node.position.x.toFixed(2)}, ${h.node.position.z.toFixed(2)})`)
      }
    } else {
      console.warn(`${DIAG_PREFIX}   → pick FAILED: screenToWorld returned null`)
      console.warn(`${DIAG_PREFIX}     successes=${pickSuccesses}/${pickAttempts}`)
      dumpCanvasDiagnostics('PICK FAILED')
    }

    // 取消所有选中 (准备新的选择)
    for (const u of units) {
      if (u.selected) console.log(`${DIAG_PREFIX}   deselecting ${u.node.name}`)
      u.selected = false
    }
    highlightSelected()
    statSelected.textContent = '0'
    console.groupEnd()
  })

  canvas.addEventListener('pointermove', (e) => {
    // 框选时的矩形绘制
    if (isSelecting) {
      const canvasRect = canvas.getBoundingClientRect()
      const x = Math.min(selStartX, e.clientX)
      const y = Math.min(selStartY, e.clientY)
      const w = Math.abs(e.clientX - selStartX)
      const h = Math.abs(e.clientY - selStartY)
      selRectEl.style.display = 'block'
      selRectEl.style.left = (x - canvasRect.left) + 'px'
      selRectEl.style.top = (y - canvasRect.top) + 'px'
      selRectEl.style.width = w + 'px'
      selRectEl.style.height = h + 'px'
    }

    // Hover 检测
    if (hoverTestEnabled && !isSelecting) {
      const canvasRect = canvas.getBoundingClientRect()
      const sx = e.clientX - canvasRect.left
      const sy = e.clientY - canvasRect.top
      const pick = screenToWorld(canvasRect, sx, sy)
      let found = false
      for (const u of units) u.hovered = false
      if (pick) {
        const hits = grid.queryPoint(pick.x, pick.z)
        if (hits.length > 0) {
          hits[hits.length - 1].hovered = true
          found = true
        }
      }
      highlightSelected()
      overlayEl.textContent =
        found ? `Hover: (${pick?.x?.toFixed(1)}, ${pick?.z?.toFixed(1)})` : `Hover: none (pick: ${pick ? 'ok' : 'null'})`
    }
  })

  canvas.addEventListener('pointerup', (e) => {
    const seq = nextSeq()
    console.group(`${DIAG_PREFIX} [EVENT #${seq}] pointerup START`)

    console.log(`${DIAG_PREFIX}   pointerId=${e.pointerId} isSelecting=${isSelecting} selStartWorld=${selStartWorld ? `(${selStartWorld.x.toFixed(2)}, ${selStartWorld.z.toFixed(2)})` : 'null'}`)

    if (!isSelecting) {
      console.log(`${DIAG_PREFIX}   SKIP: not in selection state (isSelecting=false)`)
      console.groupEnd()
      return
    }

    isSelecting = false
    selRectEl.style.display = 'none'

    if (!selStartWorld) {
      console.warn(`${DIAG_PREFIX}   SKIP: selStartWorld is null — screenToWorld failed on pointerdown`)
      overlayEl.textContent = 'Click missed ground plane — check console for details'
      console.groupEnd()
      return
    }

    const canvasRect = canvas.getBoundingClientRect()
    const sx = e.clientX - canvasRect.left
    const sy = e.clientY - canvasRect.top

    console.log(`${DIAG_PREFIX}   pointerup: client=(${e.clientX},${e.clientY}) canvasRel=(${sx.toFixed(1)}, ${sy.toFixed(1)})`)

    const endPick = screenToWorld(canvasRect, sx, sy)
    if (!endPick) {
      console.warn(`${DIAG_PREFIX}   SKIP: endPick is null — screenToWorld failed on pointerup`)
      overlayEl.textContent = 'Release missed ground plane — check console'
      console.groupEnd()
      return
    }

    const dx = Math.abs(endPick.x - selStartWorld.x)
    const dz = Math.abs(endPick.z - selStartWorld.z)
    const dragDist = Math.sqrt(dx * dx + dz * dz)

    console.log(`${DIAG_PREFIX}   startWorld=(${selStartWorld.x.toFixed(2)}, ${selStartWorld.z.toFixed(2)}) endWorld=(${endPick.x.toFixed(2)}, ${endPick.z.toFixed(2)})`)
    console.log(`${DIAG_PREFIX}   dx=${dx.toFixed(3)} dz=${dz.toFixed(3)} dragDist=${dragDist.toFixed(3)}`)

    const CLICK_THRESHOLD = 1.0 // world units

    if (dragDist < CLICK_THRESHOLD) {
      // 精确点击 (ActorsAtMouse)
      const hits = grid.queryPoint(selStartWorld.x, selStartWorld.z)
      console.log(`${DIAG_PREFIX}   → point query (ActorsAtMouse) at (${selStartWorld.x.toFixed(2)}, ${selStartWorld.z.toFixed(2)}): ${hits.length} hit(s)`)
      for (let i = 0; i < hits.length; i++) {
        const h = hits[i]
        console.log(`${DIAG_PREFIX}     hit[${i}]: ${h.node.name} at (${h.node.position.x.toFixed(2)}, ${h.node.position.z.toFixed(2)}) hw=${h.halfWidth} hh=${h.halfHeight}`)
        h.selected = true
      }
    } else {
      // 框选 (ActorsInMouseBox)
      const hits = grid.queryRect(selStartWorld.x, selStartWorld.z, endPick.x, endPick.z)
      console.log(`${DIAG_PREFIX}   → rect query (ActorsInMouseBox): ${hits.length} hit(s)`)
      for (let i = 0; i < hits.length; i++) {
        const h = hits[i]
        console.log(`${DIAG_PREFIX}     hit[${i}]: ${h.node.name} at (${h.node.position.x.toFixed(2)}, ${h.node.position.z.toFixed(2)})`)
        h.selected = true
      }
    }

    const selCount = units.filter(u => u.selected).length
    console.log(`${DIAG_PREFIX}   → final selected count: ${selCount}`)
    statSelected.textContent = String(selCount)
    overlayEl.textContent = selCount > 0
      ? `Selected: ${selCount} unit(s)`
      : `No units selected (${dragDist < CLICK_THRESHOLD ? 'point' : 'rect'} query at (${selStartWorld.x.toFixed(1)}, ${selStartWorld.z.toFixed(1)}))`
    highlightSelected()

    if (selCount === 0 && dragDist < CLICK_THRESHOLD) {
      console.warn(`${DIAG_PREFIX}   No units found at click location. Nearest unit positions:`)
      dumpUnitState()
    }

    console.groupEnd()
  })

  // ---- 诊断: pointer capture / focus / legacy mouse 事件跟踪 ----

  canvas.addEventListener('gotpointercapture', (e) => {
    console.log(`${DIAG_PREFIX} [EVENT] gotpointercapture: pointerId=${e.pointerId}`)
  })
  canvas.addEventListener('lostpointercapture', (e) => {
    console.log(`${DIAG_PREFIX} [EVENT] lostpointercapture: pointerId=${e.pointerId}`)
  })

  canvas.addEventListener('focus', () => {
    console.log(`${DIAG_PREFIX} [EVENT] canvas FOCUS`)
  })
  canvas.addEventListener('blur', () => {
    console.log(`${DIAG_PREFIX} [EVENT] canvas BLUR`)
  })

  // 保留 mousedown/mouseup/mousemove 监听器作为诊断桩。
  // 如果浏览器在 pointer capture 下仍然派发 mouse 事件，这里会记录；
  // 否则（当前观察到的情况）这些 handler 不会有输出。
  canvas.addEventListener('mousedown', (e) => {
    console.log(`${DIAG_PREFIX} [MOUSE-STUB] mousedown: button=${e.button} client=(${e.clientX},${e.clientY}) — browser fired legacy mouse event`)
  })
  canvas.addEventListener('mouseup', (e) => {
    console.log(`${DIAG_PREFIX} [MOUSE-STUB] mouseup: button=${e.button} client=(${e.clientX},${e.clientY}) — browser fired legacy mouse event`)
  })
  canvas.addEventListener('mousemove', (_e) => {
    // silently ignore, too noisy
  })

  // ---- 右键诊断菜单 ----
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    const seq = nextSeq()
    console.group(`${DIAG_PREFIX} [EVENT #${seq}] RIGHT-CLICK DIAGNOSTIC`)
    dumpCanvasDiagnostics('right-click')

    const canvasRect = canvas.getBoundingClientRect()
    const sx = e.clientX - canvasRect.left
    const sy = e.clientY - canvasRect.top

    console.log(`${DIAG_PREFIX}   CSS coords: (${sx.toFixed(1)}, ${sy.toFixed(1)})`)

    // Test scene.pick() without predicate
    const pickAll = scene.pick(sx, sy)
    console.log(`${DIAG_PREFIX}   scene.pick(no predicate): hit=${pickAll?.hit}, mesh="${pickAll?.pickedMesh?.name ?? 'null'}", point=${pickAll?.pickedPoint ? `(${pickAll.pickedPoint.x.toFixed(2)}, ${pickAll.pickedPoint.y.toFixed(2)}, ${pickAll.pickedPoint.z.toFixed(2)})` : 'null'}`)

    // Test scene.pick() with ground predicate
    const pickGround = scene.pick(sx, sy, (mesh) => mesh.name === 'ground')
    console.log(`${DIAG_PREFIX}   scene.pick(ground pred): hit=${pickGround?.hit}, mesh="${pickGround?.pickedMesh?.name ?? 'null'}", point=${pickGround?.pickedPoint ? `(${pickGround.pickedPoint.x.toFixed(2)}, ${pickGround.pickedPoint.y.toFixed(2)}, ${pickGround.pickedPoint.z.toFixed(2)})` : 'null'}`)

    // Test createPickingRay
    const ray = scene.createPickingRay(sx, sy, Matrix.Identity(), camera)
    console.log(`${DIAG_PREFIX}   createPickingRay: origin=(${ray.origin.x.toFixed(2)}, ${ray.origin.y.toFixed(2)}, ${ray.origin.z.toFixed(2)}) dir=(${ray.direction.x.toFixed(4)}, ${ray.direction.y.toFixed(4)}, ${ray.direction.z.toFixed(4)})`)

    // Our screenToWorld
    const ourPick = screenToWorld(canvasRect, sx, sy)
    console.log(`${DIAG_PREFIX}   screenToWorld (ray-plane): ${ourPick ? `(${ourPick.x.toFixed(2)}, ${ourPick.z.toFixed(2)})` : 'null'}`)

    // Point query at the picked location
    if (ourPick) {
      const hits = grid.queryPoint(ourPick.x, ourPick.z)
      console.log(`${DIAG_PREFIX}   queryPoint at pick: ${hits.length} unit(s)`)
      for (const h of hits) {
        console.log(`${DIAG_PREFIX}     ${h.node.name} at (${h.node.position.x.toFixed(2)}, ${h.node.position.z.toFixed(2)})`)
      }
    }

    // Full unit state dump
    dumpUnitState()
    console.groupEnd()
  })

  // ---- 初始化 ----
  spawnUnits(20)
  rebuildGrid()
  drawBoundsLines()

  // ---- UI 绑定 ----
  document.getElementById('btn-randomize')!.addEventListener('click', () => {
    console.log(`${DIAG_PREFIX} [UI] Randomize Positions clicked`)
    for (const unit of units) {
      unit.node.position.x = (Math.random() - 0.5) * (WORLD_W - 4)
      unit.node.position.z = (Math.random() - 0.5) * (WORLD_H - 4)
    }
    rebuildGrid()
    drawBoundsLines()
    // Clear selection
    for (const u of units) u.selected = false
    highlightSelected()
    statSelected.textContent = '0'
    overlayEl.textContent = 'Positions randomized'
  })

  document.getElementById('btn-bounds')!.addEventListener('click', function(this: HTMLElement) {
    showBounds = !showBounds
    if (showBounds) {
      this.classList.add('active')
      this.textContent = 'Show Bounds'
    } else {
      this.classList.remove('active')
      this.textContent = 'Show Bounds (off)'
    }
    drawBoundsLines()
  })

  document.getElementById('btn-mouse-bounds')!.addEventListener('click', function(this: HTMLElement) {
    showMouseBounds = !showMouseBounds
    if (showMouseBounds) {
      this.classList.add('active')
      this.textContent = 'Show Mouse Bounds'
    } else {
      this.classList.remove('active')
      this.textContent = 'Show Mouse Bounds (off)'
    }
    drawBoundsLines()
  })

  document.getElementById('btn-grid')!.addEventListener('click', function(this: HTMLElement) {
    showGrid = !showGrid
    if (showGrid) {
      this.classList.add('active')
      this.textContent = 'Show Grid'
    } else {
      this.classList.remove('active')
      this.textContent = 'Show Grid (off)'
    }
    drawGridLines()
  })

  document.getElementById('btn-hover-test')!.addEventListener('click', function(this: HTMLElement) {
    hoverTestEnabled = !hoverTestEnabled
    if (hoverTestEnabled) {
      this.classList.add('active')
      this.textContent = 'Hover Test (on)'
    } else {
      this.classList.remove('active')
      this.textContent = 'Hover Test'
    }
  })

  document.getElementById('sel-bin-size')!.addEventListener('change', (e) => {
    const val = parseInt((e.target as HTMLSelectElement).value, 10)
    console.log(`${DIAG_PREFIX} [UI] Bin size changed to ${val}`)
    grid = new SpatialGrid(WORLD_W, WORLD_H, val)
    rebuildGrid()
    drawGridLines()
  })

  // ---- 渲染循环 ----
  let fpsFrames = 0
  let fpsAccum = 0
  let lastFpsUpdate = performance.now()
  let firstFrame = true

  engine.runRenderLoop(() => {
    try {
      if (firstFrame) { lastFpsUpdate = performance.now(); firstFrame = false }

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
      console.error(`${DIAG_PREFIX} [render-loop] error:`, loopErr)
    }
  })

  const resizeObserver = new ResizeObserver(() => {
    engine.resize()
    infoViewport.textContent = `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
    // Log resize for diagnostics
    const r2 = canvas.getBoundingClientRect()
    console.log(`${DIAG_PREFIX} [RESIZE] canvas BCR: ${r2.width.toFixed(1)}x${r2.height.toFixed(1)}, engine: ${engine.getRenderWidth()}x${engine.getRenderHeight()}`)
  })
  resizeObserver.observe(canvas)
}

main().catch((err: unknown) => {
  console.error(`${DIAG_PREFIX} [fatal] main() failed:`, err)
  const errorEl = document.getElementById('gpu-error')!
  errorEl.style.display = 'flex'
  errorEl.textContent = `初始化失败: ${err instanceof Error ? err.message : String(err)}`
})
