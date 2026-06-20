/**
 * main.ts — Widget 树渲染人工验收测试
 *
 * 测试目标:
 *   1. 通过 WidgetLoader 加载 mainmenu.json 并创建完整的 Widget 树
 *   2. 验证 Widget 树正确渲染为 DOM 元素（data-widget-id 属性）
 *   3. 验证 7 种 widget 类型正确注册和实例化
 *   4. 验证 Widget 树结构（Container → Background → Button → Label → Image...）
 *   5. 验证按钮、标题、版本标签元素存在
 *
 * OpenRA 对照: Game.ts — showMainMenuWidget(), WidgetLoader.loadUI('MAINMENU')
 *              mainmenu.json — MAINMENU widget tree definition
 *
 * 设计说明:
 *   本测试页面导入真实的 WidgetLoader 和所有 7 种 widget 类型。
 *   通过 fetch 加载 public/mods/common/chrome/mainmenu.json 并注入到
 *   WidgetLoader 中，模拟 showMainMenuWidget() 的加载流程。
 */

import { ObjectCreator } from '../../../../OpenRA.Game/ModData.js'
import { WidgetLoader } from '../../../../OpenRA.Game/Widgets/WidgetLoader.js'
import type { WidgetDefinitionNode } from '../../../../OpenRA.Game/Widgets/WidgetLoader.js'
import { Widget, ContainerWidget } from '../../../../OpenRA.Game/Widgets/Widget.js'
import type { WidgetArgs } from '../../../../OpenRA.Game/Widgets/Widget.js'
import { ButtonWidget } from '../../../../OpenRA.Mods.Common/Widgets/ButtonWidget.js'
import { LabelWidget } from '../../../../OpenRA.Mods.Common/Widgets/LabelWidget.js'
import { BackgroundWidget } from '../../../../OpenRA.Mods.Common/Widgets/BackgroundWidget.js'
import { ImageWidget } from '../../../../OpenRA.Mods.Common/Widgets/ImageWidget.js'
import { DropDownButtonWidget } from '../../../../OpenRA.Mods.Common/Widgets/DropDownButtonWidget.js'
import { LogicKeyListenerWidget } from '../../../../OpenRA.Mods.Common/Widgets/LogicKeyListenerWidget.js'

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------

const sandbox = document.getElementById('sandbox')!
const widgetRoot = document.getElementById('widget-root')!
const loadingOverlay = document.getElementById('loading-overlay')!
const loadingText = document.getElementById('loading-text')!
const loadingError = document.getElementById('loading-error')!
const selScale = document.getElementById('sel-scale') as HTMLSelectElement

const infoUa = document.getElementById('info-ua')!
const infoViewport = document.getElementById('info-viewport')!
const infoWidgetCount = document.getElementById('info-widget-count')!
const infoTime = document.getElementById('info-time')!
const treeView = document.getElementById('tree-view')!

// Check indicators
const chkRootOverlay = document.getElementById('chk-root-overlay')!
const chkWidgetIds = document.getElementById('chk-widget-ids')!
const chkButtons = document.getElementById('chk-buttons')!
const chkTitle = document.getElementById('chk-title')!
const chkVersion = document.getElementById('chk-version')!
const chkLogo = document.getElementById('chk-logo')!
const chkTreeOk = document.getElementById('chk-tree-ok')!

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let widgetLoader: WidgetLoader | null = null
let rootWidget: Widget | null = null
let rootDomElement: HTMLElement | null = null

// ---------------------------------------------------------------------------
// Info Bar
// ---------------------------------------------------------------------------

function updateInfoBar(): void {
  infoUa.textContent = navigator.userAgent.slice(0, 80)
  infoViewport.textContent = `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
  infoTime.textContent = new Date().toISOString()
}

window.addEventListener('resize', updateInfoBar)
updateInfoBar()

// ---------------------------------------------------------------------------
// Scaling
// ---------------------------------------------------------------------------

function applyScale(): void {
  const scale = parseFloat(selScale.value)
  widgetRoot.style.transform = `scale(${scale})`
}

selScale.addEventListener('change', applyScale)

// ---------------------------------------------------------------------------
// Widget Tree Walk
// ---------------------------------------------------------------------------

interface TreeEntry {
  depth: number
  type: string
  id: string
  bounds: string
}

function walkTree(widget: Widget, depth: number, entries: TreeEntry[]): void {
  const typeName = widget.constructor.name
  const boundsStr = `${widget.bounds.x},${widget.bounds.y} ${widget.bounds.width}x${widget.bounds.height}`
  entries.push({ depth, type: typeName, id: widget.id || '(anonymous)', bounds: boundsStr })

  for (const child of widget.children) {
    walkTree(child, depth + 1, entries)
  }
}

function renderTreeView(): void {
  if (!rootWidget) {
    treeView.innerHTML = '<span style="color:#666">无 widget 树</span>'
    return
  }

  const entries: TreeEntry[] = []
  walkTree(rootWidget, 0, entries)

  treeView.innerHTML = entries
    .map(
      (e) =>
        `<div class="tw-node" style="padding-left:${e.depth * 16}px">` +
        `<span class="tw-type">${e.type}</span>` +
        `<span class="tw-id"> @ ${e.id}</span>` +
        `<span class="tw-bounds"> [${e.bounds}]</span>` +
        `</div>`,
    )
    .join('')

  infoWidgetCount.textContent = String(entries.length)
}

// ---------------------------------------------------------------------------
// Auto-checks
// ---------------------------------------------------------------------------

function runAutoChecks(): void {
  const allIndicators = [chkRootOverlay, chkWidgetIds, chkButtons, chkTitle, chkVersion, chkLogo, chkTreeOk]

  // Reset all to pending
  for (const ind of allIndicators) {
    ind.className = 'check-indicator pending'
  }

  // Guard: rootWidget is the authoritative source; rootDomElement may not yet be set
  if (!rootWidget) {
    for (const ind of allIndicators) {
      ind.className = 'check-indicator fail'
    }
    return
  }

  const domEl = rootDomElement
  if (!domEl) {
    for (const ind of allIndicators) {
      ind.className = 'check-indicator fail'
    }
    return
  }

  // Check 1: Root overlay element exists
  const overlay = document.getElementById('main-menu-widget-overlay')
  chkRootOverlay.className = overlay ? 'check-indicator pass' : 'check-indicator fail'

  // Check 2: data-widget-id attributes exist
  const widgetIdElements = document.querySelectorAll('[data-widget-id]')
  chkWidgetIds.className = widgetIdElements.length > 0 ? 'check-indicator pass' : 'check-indicator fail'

  // Check 3: At least 3 visible buttons
  const buttonElements = domEl.querySelectorAll('[data-widget-id]')
  const visibleButtons = Array.from(buttonElements).filter(
    (el) => {
      const id = el.getAttribute('data-widget-id') || ''
      // Button IDs from mainmenu.json: SINGLEPLAYER_BUTTON, MULTIPLAYER_BUTTON, SETTINGS_BUTTON, EXTRAS_BUTTON, CONTENT_BUTTON, QUIT_BUTTON
      return id.includes('BUTTON') && (el as HTMLElement).style.display !== 'none'
    },
  )
  chkButtons.className = visibleButtons.length >= 3 ? 'check-indicator pass' : 'check-indicator fail'

  // Check 4: Title label exists
  const titleEl = domEl.querySelector('[data-widget-id="MAINMENU_LABEL_TITLE"]')
  chkTitle.className = titleEl ? 'check-indicator pass' : 'check-indicator fail'

  // Check 5: Version label exists
  const versionEl = domEl.querySelector('[data-widget-id="VERSION_LABEL"]')
  chkVersion.className = versionEl ? 'check-indicator pass' : 'check-indicator fail'

  // Check 6: Logo image exists
  const logoEl = domEl.querySelector('[data-widget-id="LOGO"]')
  chkLogo.className = logoEl ? 'check-indicator pass' : 'check-indicator fail'

  // Check 7: Tree structure correct — root is ContainerWidget with children
  const hasContainerRoot = rootWidget instanceof ContainerWidget
  const hasChildren = rootWidget.children.length > 0
  const hasButtonsInTree = rootWidget.children.some((c: Widget) => c.constructor.name === 'ButtonWidget')
  chkTreeOk.className =
    hasContainerRoot && hasChildren && hasButtonsInTree
      ? 'check-indicator pass'
      : 'check-indicator fail'

  renderTreeView()
}

// ---------------------------------------------------------------------------
// Load Widget Menu
// ---------------------------------------------------------------------------

async function loadWidgetMenu(): Promise<void> {
  // Show loading state
  loadingOverlay.classList.remove('hidden')
  loadingText.textContent = '正在加载 Widget 树...'
  loadingError.style.display = 'none'

  try {
    // Step 1: Set widget window dimensions
    Widget.windowWidth = 1280
    Widget.windowHeight = 720

    // Step 2: Create ObjectCreator and WidgetLoader
    const objectCreator = new ObjectCreator()
    widgetLoader = new WidgetLoader(objectCreator)

    // Step 3: Register all 7 widget types (mirrors Game.showMainMenuWidget())
    widgetLoader.registerWidget('Container', ContainerWidget)
    widgetLoader.registerWidget('Button', ButtonWidget)
    widgetLoader.registerWidget('Label', LabelWidget)
    widgetLoader.registerWidget('Background', BackgroundWidget)
    widgetLoader.registerWidget('Image', ImageWidget)
    widgetLoader.registerWidget('DropDownButton', DropDownButtonWidget)
    widgetLoader.registerWidget('LogicKeyListener', LogicKeyListenerWidget)

    loadingText.textContent = '正在获取 mainmenu.json...'

    // Step 4: Fetch mainmenu.json
    const resp = await fetch('/mods/common/chrome/mainmenu.json')
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`)
    }
    const json = await resp.json() as Record<string, unknown>

    loadingText.textContent = '正在加载 Widget 布局...'

    // Step 5: Load layout into WidgetLoader
    widgetLoader.loadLayout(json as Record<string, WidgetDefinitionNode>)

    loadingText.textContent = '正在实例化 Widget 树...'

    // Step 6: Load MAINMENU UI (mirrors WidgetLoader.loadUI('MAINMENU', args))
    const args: WidgetArgs = {}
    rootWidget = widgetLoader.loadUI('MAINMENU', args)

    loadingText.textContent = '正在渲染到 DOM...'

    // Step 7: Hide sub-menus to show only main button layer
    hideSubMenus(rootWidget)

    // Step 8: Render to DOM
    rootDomElement = rootWidget.renderOuter()
    rootDomElement.id = 'main-menu-widget-overlay'
    rootDomElement.style.cssText =
      'position:absolute;inset:0;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;'

    // Step 9: Attach to widget root
    // Clear previous content
    while (widgetRoot.firstChild) {
      widgetRoot.removeChild(widgetRoot.firstChild)
    }
    widgetRoot.appendChild(rootDomElement!)

    // Step 10: Apply current scale
    applyScale()

    // Hide loading overlay
    loadingOverlay.classList.add('hidden')

    // Run checks
    runAutoChecks()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    loadingText.textContent = '加载失败'
    loadingError.textContent = msg
    loadingError.style.display = 'block'
    console.error('[widget-menu-rendering]', err)
    runAutoChecks()
  }
}

/**
 * Hide sub-menu panels in the loaded widget tree.
 * Mirrors Game._hideSubMenusOnWidgetTree().
 */
function hideSubMenus(root: Widget): void {
  const subMenuIds = [
    'SINGLEPLAYER_MENU',
    'EXTRAS_MENU',
    'MAP_EDITOR_MENU',
    'PERFORMANCE_INFO',
    'UPDATE_NOTICE',
    'PLAYER_PROFILE_CONTAINER',
  ]

  for (const id of subMenuIds) {
    const w = root.getOrNull<Widget>(id)
    if (w) w.visible = false
  }
}

// ---------------------------------------------------------------------------
// Unload
// ---------------------------------------------------------------------------

function unloadWidgetMenu(): void {
  if (rootDomElement) {
    rootDomElement.remove()
    rootDomElement = null
  }
  if (rootWidget) {
    rootWidget.dispose()
    rootWidget = null
  }
  widgetLoader = null

  // Clear widget root
  while (widgetRoot.firstChild) {
    widgetRoot.removeChild(widgetRoot.firstChild)
  }

  loadingOverlay.classList.remove('hidden')
  loadingText.textContent = '等待加载...'
  loadingError.style.display = 'none'

  // Reset checks
  const allIndicators = [chkRootOverlay, chkWidgetIds, chkButtons, chkTitle, chkVersion, chkLogo, chkTreeOk]
  for (const ind of allIndicators) {
    ind.className = 'check-indicator'
  }
  treeView.innerHTML = '<span style="color:#666">点击"加载 Widget 菜单"以查看...</span>'
  infoWidgetCount.textContent = '0'
}

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------

document.getElementById('btn-load')!.addEventListener('click', () => {
  if (rootWidget) {
    unloadWidgetMenu()
  }
  loadWidgetMenu()
})

document.getElementById('btn-reload')!.addEventListener('click', () => {
  unloadWidgetMenu()
  loadWidgetMenu()
})

document.getElementById('btn-unload')!.addEventListener('click', () => {
  unloadWidgetMenu()
})

// ---------------------------------------------------------------------------
// Sandbox resize handler — adjust widget scale based on sandbox size
// ---------------------------------------------------------------------------

function adjustScaleForSandbox(): void {
  const sandboxRect = sandbox.getBoundingClientRect()
  const availableW = sandboxRect.width - 40 // padding
  const availableH = sandboxRect.height - 40
  const widgetW = 1280
  const widgetH = 720
  const autoScale = Math.min(availableW / widgetW, availableH / widgetH, 1)

  // Update the dropdown to show auto-scale
  const option = selScale.querySelector(`option[value="${autoScale.toFixed(2)}"]`)
  if (!option) {
    // Don't change the dropdown if user has manually selected
    // Only auto-set on initial load
  }

  if (!rootWidget) {
    // No widget loaded yet — still apply for when it loads
    widgetRoot.style.transform = `scale(${autoScale})`
  }
}

window.addEventListener('resize', () => {
  if (!rootWidget) adjustScaleForSandbox()
})

// ---------------------------------------------------------------------------
// Test Harness
// ---------------------------------------------------------------------------

// Expose test harness for Playwright/automated testing
;(window as any).__testHarness = {
  load: () => loadWidgetMenu(),
  unload: () => unloadWidgetMenu(),
  reload: () => {
    unloadWidgetMenu()
    return loadWidgetMenu()
  },
  getRootWidget: () => rootWidget,
  getWidgetLoader: () => widgetLoader,
  getCheckResults: () => ({
    rootOverlay: chkRootOverlay.className.includes('pass'),
    widgetIds: chkWidgetIds.className.includes('pass'),
    buttons: chkButtons.className.includes('pass'),
    title: chkTitle.className.includes('pass'),
    version: chkVersion.className.includes('pass'),
    logo: chkLogo.className.includes('pass'),
    treeOk: chkTreeOk.className.includes('pass'),
  }),
  getWidgetCount: () => (rootWidget ? walkTreeCount(rootWidget) : 0),
  getTreeEntries: () => {
    if (!rootWidget) return []
    const entries: TreeEntry[] = []
    walkTree(rootWidget, 0, entries)
    return entries
  },
}

function walkTreeCount(w: Widget): number {
  let count = 1
  for (const child of w.children) {
    count += walkTreeCount(child)
  }
  return count
}

// ----
// Initial state
// ---------------------------------------------------------------------------

adjustScaleForSandbox()
updateInfoBar()

// Auto-load on page open
loadWidgetMenu()

if (import.meta.hot) {
  import.meta.hot.accept(() => {})
}
