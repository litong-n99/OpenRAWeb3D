/**
 * editor-ui-shell/main.ts — Editor UI Shell 人工验收测试
 *
 * 测试目标:
 *   1. 菜单栏交互：File/Edit/View/Map/Help 下拉菜单 + 点击菜单项触发正确操作
 *   2. 工具栏工具切换：Select/Paint/Fill/Erase/Line/Rect 工具激活状态互斥
 *   3. 属性面板：选中对象后显示相关字段，无选中时显示占位提示
 *   4. Minimap：渲染地图概览 + 视口矩形 + 点击/拖拽平移
 *   5. 布局完整性：1280×720 最小视口无溢出、无重叠
 *
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Editor/ (Ch21 Phase C)
 *    MapEditorLogic.cs, MapEditorTabsLogic.cs, MapToolsLogic.cs
 */

import { Engine } from '@babylonjs/core/Engines/engine'
import { Scene } from '@babylonjs/core/scene'
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { Vector3, Color3, Color4 } from '@babylonjs/core'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { ActionManager } from '@babylonjs/core/Actions/actionManager'
import { ExecuteCodeAction } from '@babylonjs/core/Actions/directActions'
import { HighlightLayer } from '@babylonjs/core/Layers/highlightLayer'
import '@babylonjs/core/Actions/actionManager'
import '@babylonjs/core/Culling/ray'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolInfo {
  type: string
  active: boolean
  disabled: boolean
  element: HTMLElement
}

interface PropertyField {
  name: string
  value: string
  group: string
  editable: boolean
}

interface MinimapViewport {
  canvas: HTMLCanvasElement
  viewportX: number
  viewportY: number
  viewportW: number
  viewportH: number
  isVisible: boolean
}

interface SelectableActor {
  name: string
  type: string
  owner: string
  cellX: number
  cellY: number
  health: number
  armor: string
  speed: string
  facing: number
  color: string
  scale: number
  mesh: import('@babylonjs/core/Meshes/mesh').Mesh
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  activeTool: 'select' as string,
  activeMenu: null as string | null,
  selectedActor: null as SelectableActor | null,
  zoomLevel: 100,
  gridVisible: true,
  minimapVisible: true,
  minimapExpanded: false,
  undoStack: 0,
  redoStack: 0,
  cameraAlpha: Math.PI / 4,
  cameraBeta: Math.PI / 3,
  cameraRadius: 60,
  lastAction: '' as string,
}

const selectableActors: SelectableActor[] = []

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

function $(id: string): HTMLElement { return document.getElementById(id)! }

const viewportCanvas = $('viewport-canvas') as HTMLCanvasElement
const minimapCanvas = $('minimap-canvas') as HTMLCanvasElement
const minimapContainer = $('minimap-container')
const toast = $('toast')
const menuDimmer = $('menu-dimmer')
const viewLabel = $('view-label')
const noSelectionMsg = $('no-selection-msg')

// Info bar refs
const infoUa = $('info-ua')
const infoViewport = $('info-viewport')
const infoEngine = $('info-engine')
const infoFps = $('info-fps')
const infoTime = $('info-time')

// Status bar refs
const stZoom = $('st-zoom')
const stCell = $('st-cell')
const stWpos = $('st-wpos')
const stLayer = $('st-layer')
const stGrid = $('st-grid')
const stMinimap = $('st-minimap')

// ---------------------------------------------------------------------------
// Info Bar
// ---------------------------------------------------------------------------

function updateInfoBar(): void {
  infoUa.textContent = navigator.userAgent.slice(0, 80)
  infoViewport.textContent = `${window.innerWidth}x${window.innerHeight} @ ${devicePixelRatio}x`
  infoTime.textContent = new Date().toISOString()
}
updateInfoBar()
setInterval(updateInfoBar, 1000)

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

let toastTimer: ReturnType<typeof setTimeout> | undefined

function showToast(message: string): void {
  toast.textContent = message
  toast.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2000)
  state.lastAction = message
}

// ---------------------------------------------------------------------------
// Status Bar
// ---------------------------------------------------------------------------

function updateStatusBar(): void {
  stZoom.textContent = `${state.zoomLevel}%`
  stGrid.textContent = state.gridVisible ? 'ON' : 'OFF'
  stMinimap.textContent = state.minimapVisible ? 'ON' : 'OFF'
  stLayer.textContent = state.selectedActor ? 'Actors' : 'Terrain'
}

// ---------------------------------------------------------------------------
// Menu System
// ---------------------------------------------------------------------------

function openMenu(menuName: string): void {
  // Close any open menu
  closeAllMenus()

  const menuItem = document.querySelector(`.menu-item[data-menu="${menuName}"]`)
  if (menuItem) {
    menuItem.classList.add('open')
    state.activeMenu = menuName
    menuDimmer.classList.add('active')
  }
}

function closeAllMenus(): void {
  document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open'))
  state.activeMenu = null
  menuDimmer.classList.remove('active')
}

// Menu bar click handlers
document.querySelectorAll('.menu-item[data-menu]').forEach(menuItem => {
  menuItem.addEventListener('click', (e) => {
    e.stopPropagation()
    const menuName = menuItem.getAttribute('data-menu')!
    if (state.activeMenu === menuName) {
      closeAllMenus()
    } else {
      openMenu(menuName)
    }
  })
})

// Dropdown item click handlers
document.querySelectorAll('.dropdown-item[data-action]').forEach(item => {
  item.addEventListener('click', (e) => {
    e.stopPropagation()
    const action = item.getAttribute('data-action')!
    handleMenuAction(action)
    closeAllMenus()
  })
})

// Dimmer click closes menus
menuDimmer.addEventListener('click', closeAllMenus)

// Escape closes menus
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.activeMenu) {
    closeAllMenus()
  }
})

function handleMenuAction(action: string): void {
  switch (action) {
    case 'new':
      showToast('📄 New Map — creating blank map...')
      resetSelection()
      state.undoStack = 0
      state.redoStack = 0
      break
    case 'open':
      showToast('📂 Open Map — file dialog would open')
      break
    case 'save':
      showToast('💾 Map Saved (Ctrl+S)')
      break
    case 'saveAs':
      showToast('💾 Save As... — save dialog would open')
      break
    case 'exit':
      showToast('🚪 Exit Editor — returning to main menu')
      break
    case 'undo':
      if (state.undoStack > 0) {
        state.undoStack--
        state.redoStack++
        showToast(`↩ Undo — ${state.undoStack} actions remaining`)
      } else {
        showToast('↩ Nothing to undo')
      }
      break
    case 'redo':
      if (state.redoStack > 0) {
        state.redoStack--
        state.undoStack++
        showToast(`↪ Redo — ${state.redoStack} actions remaining`)
      } else {
        showToast('↪ Nothing to redo')
      }
      break
    case 'cut':
      showToast('✂ Cut — copied selection to clipboard')
      break
    case 'copy':
      showToast('📋 Copy — copied to clipboard')
      break
    case 'paste':
      showToast('📄 Paste — pasted from clipboard')
      break
    case 'selectAll':
      showToast('▣ Select All — all objects selected')
      break
    case 'zoomIn':
      state.zoomLevel = Math.min(400, state.zoomLevel + 25)
      showToast(`🔍 Zoom In — ${state.zoomLevel}%`)
      break
    case 'zoomOut':
      state.zoomLevel = Math.max(25, state.zoomLevel - 25)
      showToast(`🔎 Zoom Out — ${state.zoomLevel}%`)
      break
    case 'zoomReset':
      state.zoomLevel = 100
      showToast('↺ Zoom Reset — 100%')
      break
    case 'toggleGrid':
      state.gridVisible = !state.gridVisible
      showToast(`📐 Grid ${state.gridVisible ? 'ON' : 'OFF'}`)
      break
    case 'toggleMinimap':
      state.minimapVisible = !state.minimapVisible
      minimapContainer.style.display = state.minimapVisible ? 'block' : 'none'
      showToast(`🗺 Minimap ${state.minimapVisible ? 'ON' : 'OFF'}`)
      break
    case 'mapResize':
      showToast('📏 Resize Map — dialog would open')
      break
    case 'mapProperties':
      showToast('⚙ Map Properties — dialog would open')
      break
    case 'mapValidate':
      showToast('✅ Validating map... No errors found.')
      break
    case 'helpAbout':
      showToast('ℹ OpenRAWeb3D Map Editor v0.1.0 — Phase A Shell')
      break
    case 'helpShortcuts':
      showToast('⌨ Shortcuts: S=Select P=Paint F=Fill E=Erase G=Grid M=Minimap')
      break
    default:
      showToast(`Action: ${action}`)
  }
  updateStatusBar()
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

const toolMap: Record<string, string> = {
  select: 'Select Tool — click to select actors',
  paint: 'Paint Tool — paint terrain tiles',
  fill: 'Fill Tool — fill area with tiles',
  erase: 'Erase Tool — remove actors/tiles',
  line: 'Line Tool — draw line of tiles',
  rect: 'Rectangle Tool — draw rectangle of tiles',
}

function setActiveTool(tool: string): void {
  if (tool === state.activeTool && ['undo', 'redo', 'zoomIn', 'zoomOut'].includes(tool)) {
    // Action buttons just trigger
  } else if (['undo', 'redo', 'zoomIn', 'zoomOut'].includes(tool)) {
    // Handle action buttons
    if (tool === 'undo') handleMenuAction('undo')
    else if (tool === 'redo') handleMenuAction('redo')
    else if (tool === 'zoomIn') handleMenuAction('zoomIn')
    else if (tool === 'zoomOut') handleMenuAction('zoomOut')
    return
  }

  // Deactivate previous
  document.querySelectorAll('.tool-btn.active').forEach(btn => btn.classList.remove('active'))

  // Activate new
  const btn = document.querySelector(`.tool-btn[data-tool="${tool}"]`)
  if (btn) {
    btn.classList.add('active')
    state.activeTool = tool
    viewLabel.textContent = `Editor Viewport — ${toolMap[tool] || tool}`
    showToast(`🛠 Tool: ${toolMap[tool] || tool}`)
    state.undoStack++
    state.redoStack = 0
  }
}

document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    const tool = btn.getAttribute('data-tool')!
    setActiveTool(tool)
    updateStatusBar()
  })
})

// ---------------------------------------------------------------------------
// Keyboard Shortcuts
// ---------------------------------------------------------------------------

document.addEventListener('keydown', (e) => {
  // Don't handle shortcuts when typing in editable fields or menus are open
  if ((e.target as HTMLElement)?.classList?.contains('editable')) return
  if (state.activeMenu) return

  const ctrl = e.ctrlKey || e.metaKey

  // Tool shortcuts
  if (!ctrl) {
    switch (e.key.toLowerCase()) {
      case 's': setActiveTool('select'); e.preventDefault(); return
      case 'p': setActiveTool('paint'); e.preventDefault(); return
      case 'f': setActiveTool('fill'); e.preventDefault(); return
      case 'e': setActiveTool('erase'); e.preventDefault(); return
      case 'l': setActiveTool('line'); e.preventDefault(); return
      case 'r': setActiveTool('rect'); e.preventDefault(); return
      case 'g': handleMenuAction('toggleGrid'); e.preventDefault(); return
      case 'm': handleMenuAction('toggleMinimap'); e.preventDefault(); return
      case 'z':
        if (ctrl) { handleMenuAction('undo'); e.preventDefault(); return }
        break
      case 'y':
        if (ctrl) { handleMenuAction('redo'); e.preventDefault(); return }
        break
      case 's':
        if (ctrl) { handleMenuAction('save'); e.preventDefault(); return }
        break
      case 'o':
        if (ctrl) { handleMenuAction('open'); e.preventDefault(); return }
        break
      case 'n':
        if (ctrl) { handleMenuAction('new'); e.preventDefault(); return }
        break
    }
  }
})

// ---------------------------------------------------------------------------
// Property Panel
// ---------------------------------------------------------------------------

function resetSelection(): void {
  state.selectedActor = null
  noSelectionMsg.style.display = 'block'
  document.querySelectorAll('#property-panel .prop-group').forEach(g => {
    (g as HTMLElement).style.display = 'none'
  })
}

function selectActor(actor: SelectableActor): void {
  state.selectedActor = actor
  noSelectionMsg.style.display = 'none'

  // Show all property groups
  ;['prop-group-general', 'prop-group-position', 'prop-group-health', 'prop-group-visual'].forEach(id => {
    const el = document.getElementById(id)!
    el.style.display = ''
    el.classList.remove('collapsed')
  })

  // Populate fields
  ;($('prop-name') as HTMLElement).textContent = actor.name
  ;($('prop-type') as HTMLElement).textContent = actor.type
  ;($('prop-owner') as HTMLElement).textContent = actor.owner
  ;($('prop-pos-x') as HTMLElement).textContent = String(actor.cellX)
  ;($('prop-pos-y') as HTMLElement).textContent = String(actor.cellY)
  ;($('prop-pos-world') as HTMLElement).textContent = `(${actor.cellX * 1024}, ${actor.cellY * 1024})`
  ;($('prop-health') as HTMLElement).textContent = `${actor.health} / 100`
  ;($('prop-armor') as HTMLElement).textContent = actor.armor
  ;($('prop-speed') as HTMLElement).textContent = actor.speed
  ;($('prop-facing') as HTMLElement).textContent = `${actor.facing}°`
  ;($('prop-color') as HTMLElement).textContent = actor.color
  ;($('prop-scale') as HTMLElement).textContent = String(actor.scale.toFixed(1))

  showToast(`Selected: ${actor.name} (${actor.type}) at cell(${actor.cellX}, ${actor.cellY})`)
  stCell.textContent = `(${actor.cellX}, ${actor.cellY})`
  stWpos.textContent = `(${actor.cellX * 1024}, ${actor.cellY * 1024})`
  stLayer.textContent = 'Actors'
  updateStatusBar()
}

// Collapsible property groups
document.querySelectorAll('#property-panel .prop-group-title').forEach(title => {
  title.addEventListener('click', () => {
    const group = title.parentElement!
    group.classList.toggle('collapsed')
  })
})

// ---------------------------------------------------------------------------
// Babylon.js 3D Viewport
// ---------------------------------------------------------------------------

let engine: Engine
let scene: Scene
let camera: ArcRotateCamera
let highlightLayer: HighlightLayer

function createBabylonScene(canvas: HTMLCanvasElement): void {
  engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
  scene = new Scene(engine)
  scene.clearColor = new Color4(0.05, 0.07, 0.12, 1.0)

  // Camera
  camera = new ArcRotateCamera(
    'editorCamera',
    state.cameraAlpha,
    state.cameraBeta,
    state.cameraRadius,
    new Vector3(0, 0, 0),
    scene,
  )
  camera.lowerRadiusLimit = 10
  camera.upperRadiusLimit = 200
  camera.lowerBetaLimit = 0.1
  camera.upperBetaLimit = Math.PI / 2 - 0.05
  camera.panningSensibility = 50
  camera.attachControl(canvas, true)

  // Light
  const light = new HemisphericLight('editorLight', new Vector3(0.5, 1, 0.3), scene)
  light.intensity = 0.9
  light.diffuse = new Color3(1, 1, 1)
  light.specular = new Color3(0.3, 0.3, 0.3)

  // Highlight layer for selection
  highlightLayer = new HighlightLayer('editorHighlight', scene)
  highlightLayer.innerGlow = false
  highlightLayer.outerGlow = true

  // Ground plane (terrain)
  const ground = MeshBuilder.CreateGround('terrainGround', {
    width: 50,
    height: 50,
    subdivisions: 1,
  }, scene)
  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.diffuseColor = new Color3(0.25, 0.35, 0.22)
  groundMat.specularColor = new Color3(0, 0, 0)
  ground.material = groundMat
  ground.receiveShadows = false

  // Grid lines
  createGridPlane(scene)

  // Create selectable actor meshes
  createActorMeshes(scene)

  // Ambient light
  scene.ambientColor = new Color3(0.15, 0.15, 0.2)

  infoEngine.textContent = 'Babylon.js (WebGL)'

  // Render loop
  engine.runRenderLoop(() => {
    scene.render()
  })

  // FPS counter
  let frames = 0
  let lastTime = performance.now()
  scene.onAfterRenderObservable.add(() => {
    frames++
    const now = performance.now()
    if (now - lastTime >= 1000) {
      const fps = Math.round(frames / ((now - lastTime) / 1000))
      infoFps.textContent = String(fps)
      frames = 0
      lastTime = now
    }
  })

  // Handle canvas resize
  const resizeObserver = new ResizeObserver(() => {
    engine.resize()
  })
  resizeObserver.observe(canvas)

  updateInfoBar()
}

function createGridPlane(scene: Scene): void {
  const gridSize = 50
  const step = 2
  const gridMat = new StandardMaterial('gridMat', scene)
  gridMat.diffuseColor = new Color3(0.4, 0.4, 0.4)
  gridMat.alpha = 0.3
  gridMat.specularColor = new Color3(0, 0, 0)

  // Create grid lines using thin boxes
  for (let i = -gridSize / 2; i <= gridSize / 2; i += step) {
    const hBar = MeshBuilder.CreateBox(`gridH_${i}`, {
      width: gridSize,
      height: 0.02,
      depth: 0.04,
    }, scene)
    hBar.position = new Vector3(0, 0.01, i)
    hBar.material = gridMat

    const vBar = MeshBuilder.CreateBox(`gridV_${i}`, {
      width: 0.04,
      height: 0.02,
      depth: gridSize,
    }, scene)
    vBar.position = new Vector3(i, 0.01, 0)
    vBar.material = gridMat
  }
  ;(scene as any)._gridMat = gridMat
}

function createActorMeshes(scene: Scene): void {
  interface ActorDef {
    name: string; type: string; owner: string; x: number; y: number
    color: [number, number, number]; health: number; armor: string; speed: string
  }

  const defs: ActorDef[] = [
    { name: 'harv1', type: 'Harvester', owner: 'Player', x: -8, y: -10, color: [0.8, 0.7, 0.2], health: 85, armor: 'Heavy', speed: '6.0' },
    { name: 'e1', type: 'Infantry', owner: 'Player', x: -5, y: -12, color: [0.2, 0.7, 0.2], health: 50, armor: 'Light', speed: '4.0' },
    { name: 'e2', type: 'Infantry', owner: 'Player', x: -3, y: -10, color: [0.2, 0.7, 0.2], health: 100, armor: 'Light', speed: '4.0' },
    { name: 'jeep1', type: 'Vehicle', owner: 'Player', x: 2, y: -8, color: [0.2, 0.4, 0.9], health: 60, armor: 'Medium', speed: '8.0' },
    { name: 'power1', type: 'Building', owner: 'Player', x: 10, y: -5, color: [0.4, 0.4, 0.5], health: 200, armor: 'Structure', speed: '0' },
    { name: 'barracks1', type: 'Building', owner: 'Player', x: 14, y: -5, color: [0.5, 0.4, 0.3], health: 250, armor: 'Structure', speed: '0' },
    { name: 'e3', type: 'Infantry', owner: 'Enemy', x: 8, y: 12, color: [0.8, 0.2, 0.2], health: 40, armor: 'Light', speed: '4.0' },
    { name: 'tank1', type: 'Vehicle', owner: 'Enemy', x: 12, y: 14, color: [0.8, 0.3, 0.3], health: 120, armor: 'Heavy', speed: '5.0' },
    { name: 'neutral1', type: 'Civilian', owner: 'Neutral', x: -15, y: 8, color: [0.9, 0.8, 0.4], health: 30, armor: 'Light', speed: '3.0' },
  ]

  for (const def of defs) {
    const color = def.color
    const mesh = MeshBuilder.CreateBox(def.name, {
      width: def.type === 'Building' ? 3 : def.type === 'Harvester' ? 2 : 1,
      height: def.type === 'Building' ? 2 : def.type === 'Vehicle' ? 1.2 : 0.8,
      depth: def.type === 'Building' ? 3 : def.type === 'Harvester' ? 2 : 1,
    }, scene)
    mesh.position = new Vector3(def.x, 0.5, def.y)

    const mat = new StandardMaterial(`${def.name}Mat`, scene)
    mat.diffuseColor = new Color3(color[0], color[1], color[2])
    mat.specularColor = new Color3(0.1, 0.1, 0.1)
    mesh.material = mat

    // Click to select
    mesh.actionManager = new ActionManager(scene)
    mesh.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPickTrigger, () => {
        const actor: SelectableActor = {
          name: def.name,
          type: def.type,
          owner: def.owner,
          cellX: def.x,
          cellY: -def.y, // convert Z to cell Y
          health: def.health,
          armor: def.armor,
          speed: def.speed,
          facing: Math.round(Math.random() * 360),
          color: `rgb(${Math.round(color[0]*255)},${Math.round(color[1]*255)},${Math.round(color[2]*255)})`,
          scale: 1.0,
          mesh,
        }
        selectActor(actor)

        // Highlight
        highlightLayer.removeAllMeshes()
        highlightLayer.addMesh(mesh, new Color3(0.2, 0.8, 1.0))
      }),
    )

    const actorObj: SelectableActor = {
      name: def.name,
      type: def.type,
      owner: def.owner,
      cellX: def.x,
      cellY: -def.y,
      health: def.health,
      armor: def.armor,
      speed: def.speed,
      facing: Math.round(Math.random() * 360),
      color: `rgb(${Math.round(color[0]*255)},${Math.round(color[1]*255)},${Math.round(color[2]*255)})`,
      scale: 1.0,
      mesh,
    }
    selectableActors.push(actorObj)
  }
}

// ---------------------------------------------------------------------------
// Minimap
// ---------------------------------------------------------------------------

const MINIMAP_SCALE = 4
const MINIMAP_CELLS = 64

interface MinimapState {
  viewportX: number
  viewportY: number
  viewportW: number
  viewportH: number
}

const minimapState: MinimapState = {
  viewportX: 20,
  viewportY: 22,
  viewportW: 14,
  viewportH: 10,
}

function renderMinimap(): void {
  const mmCanvas = minimapCanvas
  mmCanvas.width = 256
  mmCanvas.height = 256
  const ctx = mmCanvas.getContext('2d')!
  const imageData = ctx.createImageData(256, 256)
  const data = imageData.data

  // Render terrain-like pixels (procedural pattern)
  for (let py = 0; py < 256; py++) {
    for (let px = 0; px < 256; px++) {
      const cellX = Math.floor(px / MINIMAP_SCALE)
      const cellY = Math.floor(py / MINIMAP_SCALE)
      const hash = ((cellX * 374761393 + cellY * 668265263) & 0x7FFFFFFF)

      // Terrain bands
      let r: number, g: number, b: number
      if (cellY >= 30 && cellY <= 34 && cellX > 5 && cellX < 59) {
        // Water
        r = 30; g = 60; b = 100
      } else if (cellY === 29 || cellY === 35) {
        // Beach
        r = 180; g = 170; b = 140
      } else if (cellY === 15 && cellX > 10 && cellX < 55) {
        // Road horizontal
        r = 160; g = 136; b = 74
      } else if ((cellX >= 25 && cellX <= 35 && cellY >= 40 && cellY <= 46) ||
                 (cellX >= 45 && cellX <= 55 && cellY >= 8 && cellY <= 14)) {
        // Ore patches
        r = 85; g = 85; b = 85
      } else if (cellY === 20 && cellX > 8 && cellX < 52) {
        // Cliff
        r = 100; g = 60; b = 40
      } else {
        // Clear / Rough
        const isClear = hash % 10 < 7
        r = isClear ? 74 : 139
        g = isClear ? 124 : 115
        b = isClear ? 63 : 85
      }

      const pixelIdx = (py * 256 + px) * 4
      data[pixelIdx] = r
      data[pixelIdx + 1] = g
      data[pixelIdx + 2] = b
      data[pixelIdx + 3] = 255
    }
  }

  ctx.putImageData(imageData, 0, 0)

  // Draw actor dots
  for (const actor of selectableActors) {
    const mx = (actor.cellX + MINIMAP_CELLS / 2) * MINIMAP_SCALE
    const my = (-actor.cellY + MINIMAP_CELLS / 2) * MINIMAP_SCALE
    ctx.fillStyle = actor.owner === 'Player' ? '#32cd32' : actor.owner === 'Enemy' ? '#ff4444' : '#ffcc00'
    ctx.beginPath()
    ctx.arc(mx, my, 2, 0, Math.PI * 2)
    ctx.fill()
  }

  // Draw viewport rectangle
  const vx = minimapState.viewportX * MINIMAP_SCALE
  const vy = minimapState.viewportY * MINIMAP_SCALE
  const vw = minimapState.viewportW * MINIMAP_SCALE
  const vh = minimapState.viewportH * MINIMAP_SCALE
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.5
  ctx.strokeRect(vx, vy, vw, vh)
  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  ctx.fillRect(vx, vy, vw, vh)
}

// Minimap click: move viewport
minimapCanvas.addEventListener('click', (e) => {
  const rect = minimapCanvas.getBoundingClientRect()
  const scaleX = 256 / rect.width
  const scaleY = 256 / rect.height
  const px = (e.clientX - rect.left) * scaleX
  const py = (e.clientY - rect.top) * scaleY
  const cx = Math.floor(px / MINIMAP_SCALE)
  const cy = Math.floor(py / MINIMAP_SCALE)

  // Center viewport on click
  minimapState.viewportX = Math.max(0, Math.min(MINIMAP_CELLS - minimapState.viewportW,
    cx - Math.floor(minimapState.viewportW / 2)))
  minimapState.viewportY = Math.max(0, Math.min(MINIMAP_CELLS - minimapState.viewportH,
    cy - Math.floor(minimapState.viewportH / 2)))

  renderMinimap()
  showToast(`🗺 Minimap click at cell(${cx}, ${cy}) — viewport moved`)
})

// Minimap expand/collapse
$('mm-expand-btn').addEventListener('click', (e) => {
  e.stopPropagation()
  state.minimapExpanded = !state.minimapExpanded
  if (state.minimapExpanded) {
    minimapContainer.classList.add('expanded')
    ;($('mm-expand-btn') as HTMLButtonElement).textContent = '−'
  } else {
    minimapContainer.classList.remove('expanded')
    ;($('mm-expand-btn') as HTMLButtonElement).textContent = '＋'
  }
  setTimeout(renderMinimap, 50)
})

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function init(): void {
  // Setup viewport canvas size
  viewportCanvas.width = viewportCanvas.clientWidth * devicePixelRatio
  viewportCanvas.height = viewportCanvas.clientHeight * devicePixelRatio

  // Initialize Babylon.js
  createBabylonScene(viewportCanvas)

  // Render minimap
  renderMinimap()

  // Initial state
  updateStatusBar()
  resetSelection()
  updateInfoBar()

  // Handle window resize for info bar
  window.addEventListener('resize', () => {
    updateInfoBar()
    renderMinimap()
  })

  console.log('[Editor UI Shell] Initialized. All subsystems online.')
  console.log('  - Menu bar: 5 menus (File, Edit, View, Map, Help)')
  console.log('  - Toolbar: 10 tools (Select, Paint, Fill, Erase, Line, Rect, Undo, Redo, Zoom+, Zoom-)')
  console.log('  - Property panel: 4 groups (General, Position, Stats, Visual)')
  console.log('  - Minimap: 64-cell terrain overview with viewport rect')
  console.log('  - 3D Viewport: Babylon.js with 9 selectable actors')
  console.log('  - Status bar: zoom, cell, WPos, layer, grid, minimap toggles')
}

// ---------------------------------------------------------------------------
// Test Harness
// ---------------------------------------------------------------------------

;(window as any).__testHarness = {
  /**
   * Returns all toolbar tool buttons with their current state.
   */
  getToolbarTools(): ToolInfo[] {
    const tools: ToolInfo[] = []
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
      const el = btn as HTMLElement
      tools.push({
        type: el.getAttribute('data-tool')!,
        active: el.classList.contains('active'),
        disabled: el.hasAttribute('disabled'),
        element: el,
      })
    })
    return tools
  },

  /**
   * Returns minimap viewport state.
   */
  getMinimapViewport(): MinimapViewport {
    return {
      canvas: minimapCanvas,
      viewportX: minimapState.viewportX,
      viewportY: minimapState.viewportY,
      viewportW: minimapState.viewportW,
      viewportH: minimapState.viewportH,
      isVisible: state.minimapVisible,
    }
  },

  /**
   * Returns property panel fields (only for currently selected actor).
   */
  getPropertyPanelFields(): PropertyField[] {
    if (!state.selectedActor) return []

    const fields: PropertyField[] = []
    const groups: Record<string, Array<{ id: string; label: string; editable: boolean }>> = {
      General: [
        { id: 'prop-name', label: 'Name', editable: true },
        { id: 'prop-type', label: 'Type', editable: false },
        { id: 'prop-owner', label: 'Owner', editable: false },
      ],
      Position: [
        { id: 'prop-pos-x', label: 'Cell X', editable: true },
        { id: 'prop-pos-y', label: 'Cell Y', editable: true },
        { id: 'prop-pos-world', label: 'World', editable: false },
      ],
      Stats: [
        { id: 'prop-health', label: 'Health', editable: true },
        { id: 'prop-armor', label: 'Armor', editable: false },
        { id: 'prop-speed', label: 'Speed', editable: false },
      ],
      Visual: [
        { id: 'prop-facing', label: 'Facing', editable: true },
        { id: 'prop-color', label: 'Color', editable: false },
        { id: 'prop-scale', label: 'Scale', editable: true },
      ],
    }

    for (const [group, groupFields] of Object.entries(groups)) {
      for (const f of groupFields) {
        const el = document.getElementById(f.id)!
        fields.push({
          name: f.label,
          value: el.textContent || '-',
          group,
          editable: f.editable,
        })
      }
    }

    return fields
  },

  /**
   * Clicks a menu item programmatically.
   * @param menu - Menu name: 'file', 'edit', 'view', 'map', 'help'
   * @param item - Action name: 'new', 'open', 'save', 'undo', etc.
   */
  clickMenu(menu: string, item: string): void {
    // Find the menu by data-menu attribute
    const menuEl = document.querySelector(`.menu-item[data-menu="${menu}"]`)
    if (!menuEl) {
      console.warn(`[TestHarness] Menu "${menu}" not found`)
      return
    }

    // Open the menu first
    openMenu(menu)

    // Find and click the dropdown item
    const dropdownItem = menuEl.querySelector(`.dropdown-item[data-action="${item}"]`)
    if (dropdownItem) {
      ;(dropdownItem as HTMLElement).click()
    } else {
      console.warn(`[TestHarness] Menu item "${item}" not found in menu "${menu}"`)
      closeAllMenus()
    }
  },

  /**
   * Resets the entire editor UI to default state.
   */
  reset(): void {
    // Deselect
    resetSelection()
    highlightLayer.removeAllMeshes()

    // Reset tool
    state.activeTool = 'select'
    document.querySelectorAll('.tool-btn.active').forEach(b => b.classList.remove('active'))
    const selectBtn = document.querySelector('.tool-btn[data-tool="select"]')
    if (selectBtn) selectBtn.classList.add('active')

    // Reset zoom
    state.zoomLevel = 100
    state.gridVisible = true
    state.minimapVisible = true
    minimapContainer.style.display = 'block'
    state.minimapExpanded = false
    minimapContainer.classList.remove('expanded')
    ;($('mm-expand-btn') as HTMLButtonElement).textContent = '＋'

    // Reset minimap viewport
    minimapState.viewportX = 20
    minimapState.viewportY = 22
    minimapState.viewportW = 14
    minimapState.viewportH = 10

    // Reset undo/redo
    state.undoStack = 0
    state.redoStack = 0

    // Reset camera
    camera.alpha = Math.PI / 4
    camera.beta = Math.PI / 3
    camera.radius = 60
    camera.target = new Vector3(0, 0, 0)

    // Update UI
    viewLabel.textContent = 'Editor Viewport — Select Tool Active'
    closeAllMenus()
    updateStatusBar()
    renderMinimap()

    showToast('🔄 Editor reset to default state')
  },

  // Additional debug access
  getState: () => ({ ...state }),
  getSelectableActors: () => selectableActors,
  selectActorByName: (name: string) => {
    const actor = selectableActors.find(a => a.name === name)
    if (actor) selectActor(actor)
  },
  getCameraState: () => ({
    alpha: camera.alpha,
    beta: camera.beta,
    radius: camera.radius,
    target: { x: camera.target.x, y: camera.target.y, z: camera.target.z },
  }),
  getLastAction: () => state.lastAction,
  getActiveTool: () => state.activeTool,
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

init()

// HMR support
if (import.meta.hot) {
  import.meta.hot.accept(() => {})
}
