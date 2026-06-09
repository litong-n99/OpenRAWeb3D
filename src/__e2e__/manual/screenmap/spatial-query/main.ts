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

// ---------------------------------------------------------------------------
// Unit 数据结构 — 模拟 Actor 的空间索引条目
// ---------------------------------------------------------------------------

interface Unit {
  node: TransformNode
  mesh: Mesh
  /** 包圍盒在世界 XZ 平面上的宽度 (对应 ScreenBounds 宽度的一半) */
  halfWidth: number
  /** 包圍盒在世界 XZ 平面上的高度 (对应 ScreenBounds 高度的一半) */
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
          // 检查 Unit 包围盒是否与查询矩形相交
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
// Unit 包圍盒可视化 Line
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
  canvas.width = Math.max(sandboxEl.getBoundingClientRect().width || 800, 1)
  canvas.height = Math.max(sandboxEl.getBoundingClientRect().height || 600, 1)
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
    'cam', -Math.PI / 4, Math.PI / 4, 25,
    new Vector3(0, 0, 0), scene,
  )
  camera.lowerRadiusLimit = 5
  camera.upperRadiusLimit = 50
  camera.panningSensibility = 500
  // Explicitly set as active camera for scene.pick() / createPickingRay()
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

  // ---- 诊断: 输出 canvas/engine 尺寸信息 ----
  console.log('[screenmap] === Canvas & Engine Dimensions ===')
  console.log(`[screenmap] canvas.width (attr):  ${canvas.width}`)
  console.log(`[screenmap] canvas.height (attr): ${canvas.height}`)
  console.log(`[screenmap] canvas.style.width:     ${canvas.style.width}`)
  console.log(`[screenmap] canvas.style.height:    ${canvas.style.height}`)
  const initRect = canvas.getBoundingClientRect()
  console.log(`[screenmap] canvas.getBoundingClientRect(): ${initRect.width} x ${initRect.height}`)
  console.log(`[screenmap] engine.getRenderWidth():  ${engine.getRenderWidth()}`)
  console.log(`[screenmap] engine.getRenderHeight(): ${engine.getRenderHeight()}`)
  console.log(`[screenmap] engine.getHardwareScalingLevel(): ${engine.getHardwareScalingLevel()}`)
  console.log(`[screenmap] scene.activeCamera: ${scene.activeCamera?.name ?? 'NULL'}`)
  console.log(`[screenmap] scene.cameras.length: ${scene.cameras.length}`)
  console.log(`[screenmap] scene.meshes.length: ${scene.meshes.length}`)
  for (const m of scene.meshes) {
    console.log(`[screenmap]   mesh: name="${m.name}", isPickable=${m.isPickable}, isVisible=${m.isVisible}, isEnabled=${m.isEnabled()}`)
  }

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
    // 清除旧 unit
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
      // Unit meshes must NOT be pickable, otherwise scene.pick() will hit them
      // instead of the ground, causing screenToWorld() to return null.
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
        // Mouse bounds 多边形
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
  //
  // 原因: scene.pick() 依赖场景中的 pickable mesh。如果 ground mesh 因为
  // 任何原因未被射线命中（坐标缩放、viewport 偏移、camera frustum 问题等），
  // 整个点击链路就会静默失败。使用 createPickingRay 直接从 camera 的 view/
  // projection 矩阵反算出世界空间射线，然后与 XZ 平面 (y=0) 求交，完全不
  // 依赖 mesh picking，从根本上消除这类"看不见"的故障。
  // -------------------------------------------------------------------------

  /**
   * 将屏幕像素坐标转换为世界 XZ 平面坐标
   *
   * @param canvasRect canvas.getBoundingClientRect() 结果
   * @param sx CSS 像素相对于 canvas 左上角的 X
   * @param sy CSS 像素相对于 canvas 左上角的 Y
   * @returns 世界空间 XZ 平面交点，或 null（射线与 XZ 平面平行/背离）
   */
  function screenToWorld(
    canvasRect: DOMRect,
    sx: number,
    sy: number,
  ): { x: number; z: number } | null {
    // Step 1: 将 CSS 像素转换为 engine rendering 坐标
    //    hardwareScalingLevel = 1.0 时两者一致；非 1.0 时需要缩放
    const renderWidth = engine.getRenderWidth()
    const renderHeight = engine.getRenderHeight()
    const scaleX = renderWidth / (canvasRect.width || 1)
    const scaleY = renderHeight / (canvasRect.height || 1)
    const pickX = sx * scaleX
    const pickY = sy * scaleY

    // Step 2: 用 camera 的 view/projection 创建世界空间射线
    //    createPickingRay 内部会调用 camera.getViewMatrix() 和
    //    camera.getProjectionMatrix() 进行 unproject
    const ray = scene.createPickingRay(
      pickX, pickY,
      Matrix.Identity(),  // world matrix — identity = world space
      camera,              // 显式传入 camera，不依赖 scene.activeCamera
    )

    // Step 3: 射线与 XZ 平面 (y=0) 求交
    //    ray = origin + t * direction
    //    求 origin.y + t * direction.y = 0 → t = -origin.y / direction.y
    if (Math.abs(ray.direction.y) < 1e-8) {
      // 射线几乎平行于 XZ 平面 (camera 视角极低)
      return null
    }

    const t = -ray.origin.y / ray.direction.y
    if (t <= 0) {
      // 交点在射线后方（camera 在 XZ 平面以下）
      return null
    }

    const wx = ray.origin.x + t * ray.direction.x
    const wz = ray.origin.z + t * ray.direction.z

    // 只返回世界范围内的交点
    if (wx < -WORLD_W / 2 || wx > WORLD_W / 2 || wz < -WORLD_H / 2 || wz > WORLD_H / 2) {
      return { x: wx, z: wz } // 仍然返回，让 queryPoint/queryRect 自行判断
    }

    return { x: wx, z: wz }
  }

  // -------------------------------------------------------------------------
  // 点击/框选事件处理
  // -------------------------------------------------------------------------

  const selRect = document.getElementById('selection-rect')!
  const statSelected = document.getElementById('stat-selected')!
  const overlayEl = document.getElementById('overlay')!

  let isSelecting = false
  let selStartX = 0
  let selStartY = 0
  let selStartWorld: { x: number; z: number } | null = null
  // 点击诊断计数器
  let pickAttempts = 0
  let pickSuccesses = 0

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return

    pickAttempts++
    isSelecting = true
    selStartX = e.clientX
    selStartY = e.clientY

    const canvasRect = canvas.getBoundingClientRect()
    const sx = e.clientX - canvasRect.left
    const sy = e.clientY - canvasRect.top

    console.log(`[screenmap] mousedown #${pickAttempts}: client=(${e.clientX},${e.clientY}) canvasRect=(${canvasRect.left},${canvasRect.top},${canvasRect.width},${canvasRect.height}) pickCSS=(${sx},${sy})`)

    const pick = screenToWorld(canvasRect, sx, sy)
    selStartWorld = pick

    if (pick) {
      pickSuccesses++
      console.log(`[screenmap]   → pick SUCCESS: world=(${pick.x.toFixed(2)}, ${pick.z.toFixed(2)}) successes=${pickSuccesses}/${pickAttempts}`)
    } else {
      console.warn(`[screenmap]   → pick FAILED: screenToWorld returned null successes=${pickSuccesses}/${pickAttempts}`)
      console.warn(`[screenmap]     engine renderSize=(${engine.getRenderWidth()},${engine.getRenderHeight()}) scale=(${(engine.getRenderWidth() / (canvasRect.width || 1)).toFixed(3)}, ${(engine.getRenderHeight() / (canvasRect.height || 1)).toFixed(3)})`)
    }

    // 取消所有选中
    for (const u of units) u.selected = false
    highlightSelected()
    statSelected.textContent = '0'
  })

  canvas.addEventListener('mousemove', (e) => {
    if (isSelecting) {
      const canvasRect = canvas.getBoundingClientRect()
      const x = Math.min(selStartX, e.clientX)
      const y = Math.min(selStartY, e.clientY)
      const w = Math.abs(e.clientX - selStartX)
      const h = Math.abs(e.clientY - selStartY)
      selRect.style.display = 'block'
      selRect.style.left = (x - canvasRect.left) + 'px'
      selRect.style.top = (y - canvasRect.top) + 'px'
      selRect.style.width = w + 'px'
      selRect.style.height = h + 'px'
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
          // 找到最近的一个（按 Z-order）
          hits[hits.length - 1].hovered = true
          found = true
        }
      }
      highlightSelected()
      overlayEl.textContent =
        found ? `Hover: (${pick?.x?.toFixed(1)}, ${pick?.z?.toFixed(1)})` : `Hover: none (pick: ${pick ? 'ok' : 'null'})`
    }
  })

  canvas.addEventListener('mouseup', (e) => {
    if (!isSelecting) return
    isSelecting = false
    selRect.style.display = 'none'

    if (!selStartWorld) {
      console.warn('[screenmap] mouseup: selStartWorld is null, skipping selection')
      overlayEl.textContent = 'Click missed ground plane — check console for details'
      return
    }

    const canvasRect = canvas.getBoundingClientRect()
    const sx = e.clientX - canvasRect.left
    const sy = e.clientY - canvasRect.top
    const endPick = screenToWorld(canvasRect, sx, sy)
    if (!endPick) {
      console.warn('[screenmap] mouseup: endPick is null, skipping selection')
      overlayEl.textContent = 'Release missed ground plane — check console'
      return
    }

    const dx = Math.abs(endPick.x - selStartWorld.x)
    const dz = Math.abs(endPick.z - selStartWorld.z)

    console.log(`[screenmap] mouseup: startWorld=(${selStartWorld.x.toFixed(2)},${selStartWorld.z.toFixed(2)}) endWorld=(${endPick.x.toFixed(2)},${endPick.z.toFixed(2)}) dx=${dx.toFixed(3)} dz=${dz.toFixed(3)}`)

    if (dx < 0.5 && dz < 0.5) {
      // 精确点击 (ActorsAtMouse) — 使用点查询
      const hits = grid.queryPoint(selStartWorld.x, selStartWorld.z)
      console.log(`[screenmap]   → point query (ActorsAtMouse) at (${selStartWorld.x.toFixed(2)}, ${selStartWorld.z.toFixed(2)}): ${hits.length} hit(s)`)
      for (const h of hits) h.selected = true
    } else {
      // 框选 (ActorsInMouseBox) — 使用矩形查询
      const hits = grid.queryRect(selStartWorld.x, selStartWorld.z, endPick.x, endPick.z)
      console.log(`[screenmap]   → rect query (ActorsInMouseBox): ${hits.length} hit(s)`)
      for (const h of hits) h.selected = true
    }

    const selCount = units.filter(u => u.selected).length
    statSelected.textContent = String(selCount)
    overlayEl.textContent = selCount > 0
      ? `Selected: ${selCount} unit(s)`
      : `No units selected (${dx < 0.5 && dz < 0.5 ? 'point' : 'rect'} query)`
    highlightSelected()
  })

  // -------------------------------------------------------------------------
  // 诊断: 添加一个「测试 scene.pick()」按钮
  // -------------------------------------------------------------------------
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    const canvasRect = canvas.getBoundingClientRect()
    const sx = e.clientX - canvasRect.left
    const sy = e.clientY - canvasRect.top

    console.log('[screenmap] === scene.pick() diagnostic (right-click) ===')
    console.log(`[screenmap]   CSS coords: (${sx.toFixed(1)}, ${sy.toFixed(1)})`)

    // Test scene.pick() without predicate — what does it hit?
    const pickAll = scene.pick(sx, sy)
    console.log(`[screenmap]   scene.pick(no predicate): hit=${pickAll?.hit}, mesh="${pickAll?.pickedMesh?.name ?? 'null'}", point=${pickAll?.pickedPoint ? `(${pickAll.pickedPoint.x.toFixed(2)}, ${pickAll.pickedPoint.y.toFixed(2)}, ${pickAll.pickedPoint.z.toFixed(2)})` : 'null'}`)

    // Test scene.pick() with predicate
    const pickGround = scene.pick(sx, sy, (mesh) => mesh.name === 'ground')
    console.log(`[screenmap]   scene.pick(ground predicate): hit=${pickGround?.hit}, mesh="${pickGround?.pickedMesh?.name ?? 'null'}", point=${pickGround?.pickedPoint ? `(${pickGround.pickedPoint.x.toFixed(2)}, ${pickGround.pickedPoint.y.toFixed(2)}, ${pickGround.pickedPoint.z.toFixed(2)})` : 'null'}`)

    // Test createPickingRay
    const ray = scene.createPickingRay(sx, sy, Matrix.Identity(), camera)
    console.log(`[screenmap]   createPickingRay: origin=(${ray.origin.x.toFixed(2)}, ${ray.origin.y.toFixed(2)}, ${ray.origin.z.toFixed(2)}) dir=(${ray.direction.x.toFixed(3)}, ${ray.direction.y.toFixed(3)}, ${ray.direction.z.toFixed(3)})`)

    const ourPick = screenToWorld(canvasRect, sx, sy)
    console.log(`[screenmap]   screenToWorld (ray-plane): ${ourPick ? `(${ourPick.x.toFixed(2)}, ${ourPick.z.toFixed(2)})` : 'null'}`)
  })

  // ---- 初始化 ----
  spawnUnits(20)
  rebuildGrid()
  drawBoundsLines()

  // ---- UI 绑定 ----
  document.getElementById('btn-randomize')!.addEventListener('click', () => {
    for (const unit of units) {
      unit.node.position.x = (Math.random() - 0.5) * (WORLD_W - 4)
      unit.node.position.z = (Math.random() - 0.5) * (WORLD_H - 4)
    }
    rebuildGrid()
    drawBoundsLines()
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
