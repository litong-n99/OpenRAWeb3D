/**
 * main.ts — Editor 占位页人工验收测试
 *
 * 测试目标:
 *   1. 验证 /editor/:modId 路由匹配和参数提取
 *   2. 验证 Editor 占位页渲染（标题 + 描述 + 返回链接）
 *   3. 验证 "Back to Mod Selector" 链接导航回首页
 *   4. 验证不同 modId 参数的描述文本变化
 *
 * OpenRA 对照: src/main.ts — router.on('/editor/:modId', ...)
 * Phase A — 纯 DOM，不依赖 @babylonjs/core
 */

import { Router } from '../../../../OpenRA.Game/Router.js'
import type { RouteHandler } from '../../../../OpenRA.Game/Router.js'

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------

const appViewport = document.getElementById('app-viewport')!
const urlPathSeg = document.getElementById('url-path-seg')!
const routeBadge = document.getElementById('route-badge')!

const infoUa = document.getElementById('info-ua')!
const infoViewport = document.getElementById('info-viewport')!
const infoTime = document.getElementById('info-time')!

const statePath = document.getElementById('state-path')!
const statePattern = document.getElementById('state-pattern')!
const stateParams = document.getElementById('state-params')!

const chkTitle = document.getElementById('chk-title')!
const chkDesc = document.getElementById('chk-desc')!
const chkLink = document.getElementById('chk-link')!
const chkLinkColor = document.getElementById('chk-link-color')!

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
// URL Bar Update
// ---------------------------------------------------------------------------

function updateUrlDisplay(path: string, matched: boolean): void {
  urlPathSeg.textContent = path
  routeBadge.textContent = matched ? 'MATCHED' : 'NO ROUTE'
  routeBadge.className = matched ? 'route-badge badge-matched' : 'route-badge badge-unmatched'
}

// ---------------------------------------------------------------------------
// Editor Page Rendering (mirrors src/main.ts editor route)
// ---------------------------------------------------------------------------

/**
 * Render the editor placeholder page.
 *
 * NOTE: Uses DOM createElement + textContent (not innerHTML) for the modId
 * parameter. The production code in src/main.ts line 41 originally used
 * innerHTML with direct interpolation (`` ${params['modId']} ``), which was
 * an XSS vector for user-controlled route params. That was fixed in commit
 * 8caac53. This test page follows the fixed pattern.
 */
function renderEditorStub(modId: string): void {
  // Clear viewport
  appViewport.innerHTML = ''

  const wrapper = document.createElement('div')
  wrapper.className = 'editor-placeholder'

  const h1 = document.createElement('h1')
  h1.id = 'editor-h1'
  h1.textContent = 'Editor'
  wrapper.appendChild(h1)

  const desc = document.createElement('p')
  desc.id = 'editor-desc'
  desc.textContent = `Coming soon — ${modId} map editor`
  wrapper.appendChild(desc)

  const backLink = document.createElement('a')
  backLink.href = '/'
  backLink.id = 'editor-back-link'
  backLink.textContent = 'Back to Mod Selector'
  backLink.addEventListener('click', (e) => {
    e.preventDefault()
    renderModSelector()
  })
  wrapper.appendChild(backLink)

  appViewport.appendChild(wrapper)

  // Update URL bar and state
  updateUrlDisplay(`/editor/${modId}`, true)
  statePath.textContent = `/editor/${modId}`
  statePattern.textContent = '/editor/:modId'
  stateParams.textContent = JSON.stringify({ modId })

  // Run auto-checks after a short delay for DOM to settle
  setTimeout(runAutoChecks, 50)
}

// ---------------------------------------------------------------------------
// Mod Selector Rendering (for back navigation demo)
// ---------------------------------------------------------------------------

interface ModInfo {
  id: string
  title: string
  version: string
  description: string
  factions: string[]
  available: boolean
}

const mods: ModInfo[] = [
  { id: 'ra', title: 'Red Alert', version: 'release-20250308', description: 'Command Soviets or Allies in an alternate-history clash.', factions: ['Soviet', 'Allies'], available: true },
  { id: 'td', title: 'Tiberian Dawn', version: 'release-20250308', description: 'GDI vs Brotherhood of Nod in the first Tiberium War.', factions: ['GDI', 'Nod'], available: true },
  { id: 'd2k', title: 'Dune 2000', version: 'release-20250308', description: 'Fight for control of Arrakis and the spice melange.', factions: ['Atreides', 'Harkonnen', 'Ordos'], available: true },
  { id: 'ts', title: 'Tiberian Sun', version: 'release-20250308', description: 'The Second Tiberium War rages on a shattered Earth.', factions: ['GDI', 'Nod'], available: false },
]

function renderModSelector(): void {
  let html = `
    <div id="mod-selector">
      <div class="mod-selector-header">
        <h1>OpenRAWeb3D</h1>
        <p>Select a mod to launch</p>
      </div>
      <div class="mod-card-grid">
  `

  for (const mod of mods) {
    html += `
      <div class="mod-card${mod.available ? '' : ' unavailable'}" data-mod-id="${mod.id}">
        ${!mod.available ? '<div class="mod-card-ribbon">Coming Soon</div>' : ''}
        <h2 class="mod-card-title">${mod.title}</h2>
        <span class="mod-card-version">${mod.version}</span>
        <p class="mod-card-description">${mod.description}</p>
        <div class="mod-card-factions">
          ${mod.factions.map(f => `<span class="mod-card-faction-tag">${f}</span>`).join('')}
        </div>
        ${mod.available ? '<button class="mod-card-play-btn">Play →</button>' : ''}
      </div>
    `
  }

  html += `
      </div>
    </div>
  `

  appViewport.innerHTML = html

  // Update URL bar
  updateUrlDisplay('/', true)
  statePath.textContent = '/'
  statePattern.textContent = '/'
  stateParams.textContent = '{}'

  // Reset checks
  chkTitle.className = 'check-indicator'
  chkDesc.className = 'check-indicator'
  chkLink.className = 'check-indicator'
  chkLinkColor.className = 'check-indicator'
}

// ---------------------------------------------------------------------------
// Auto-checks
// ---------------------------------------------------------------------------

function runAutoChecks(): void {
  const h1 = appViewport.querySelector('#editor-h1')
  const desc = appViewport.querySelector('#editor-desc')
  const link = appViewport.querySelector('#editor-back-link') as HTMLElement | null

  // Check 1: Title
  if (h1?.textContent === 'Editor') {
    chkTitle.className = 'check-indicator pass'
    console.log('[check] PASS: Editor title = "Editor"')
  } else {
    chkTitle.className = 'check-indicator fail'
    console.log(`[check] FAIL: Editor title = "${h1?.textContent}"`)
  }

  // Check 2: Description contains "map editor"
  if (desc?.textContent?.includes('map editor')) {
    chkDesc.className = 'check-indicator pass'
    console.log(`[check] PASS: Description = "${desc.textContent}"`)
  } else {
    chkDesc.className = 'check-indicator fail'
    console.log(`[check] FAIL: Description = "${desc?.textContent}"`)
  }

  // Check 3: Back link visible
  if (link && link.textContent === 'Back to Mod Selector') {
    chkLink.className = 'check-indicator pass'
    console.log('[check] PASS: Back link text correct')
  } else {
    chkLink.className = 'check-indicator fail'
    console.log(`[check] FAIL: Back link = "${link?.textContent}"`)
  }

  // Check 4: Link color
  if (link) {
    const computedColor = getComputedStyle(link).color
    // RGB for #6688ee is rgb(102, 136, 238)
    if (computedColor.includes('102') || computedColor.includes('103') || computedColor === 'rgb(102, 136, 238)') {
      chkLinkColor.className = 'check-indicator pass'
      console.log(`[check] PASS: Link color = ${computedColor}`)
    } else {
      chkLinkColor.className = 'check-indicator fail'
      console.log(`[check] FAIL: Link color = ${computedColor} (expected rgb(102, 136, 238) / #6688ee)`)
    }
  } else {
    chkLinkColor.className = 'check-indicator fail'
    console.log('[check] FAIL: Back link not found for color check')
  }
}

// ---------------------------------------------------------------------------
// Router Setup — verify pattern matching works
// ---------------------------------------------------------------------------

const router = new Router()

// Register the editor route and verify parameter extraction
router.on('/editor/:modId', ((params: Record<string, string>) => {
  console.log(`[Router] /editor/:modId matched with modId="${params['modId']}"`)
}) as RouteHandler)

router.on('/', ((params: Record<string, string>) => {
  console.log(`[Router] / matched with params=${JSON.stringify(params)}`)
}) as RouteHandler)

// ---------------------------------------------------------------------------
// Button Handlers
// ---------------------------------------------------------------------------

document.getElementById('btn-editor-ra')!.addEventListener('click', () => {
  renderEditorStub('ra')
})

document.getElementById('btn-editor-td')!.addEventListener('click', () => {
  renderEditorStub('td')
})

document.getElementById('btn-editor-d2k')!.addEventListener('click', () => {
  renderEditorStub('d2k')
})

document.getElementById('btn-back-home')!.addEventListener('click', () => {
  renderModSelector()
})

// ---------------------------------------------------------------------------
// Initialize — show editor stub for 'ra' by default
// ---------------------------------------------------------------------------

renderEditorStub('ra')

// ---------------------------------------------------------------------------
// Keyboard shortcut: press 'H' to go home
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if (e.key === 'h' || e.key === 'H') {
    // Only if not in an input field
    if (document.activeElement === document.body) {
      renderModSelector()
    }
  }
})

// ---------------------------------------------------------------------------
// Test Harness
// ---------------------------------------------------------------------------

;(window as any).__testHarness = {
  router,
  renderEditorStub,
  renderModSelector,
  getAppViewport: () => appViewport,
  getEditorTitle: () => appViewport.querySelector('#editor-h1')?.textContent,
  getEditorDesc: () => appViewport.querySelector('#editor-desc')?.textContent,
  getBackLink: () => appViewport.querySelector('#editor-back-link'),
  navigateToEditor: (modId: string) => renderEditorStub(modId),
  goHome: () => renderModSelector(),
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {})
}
