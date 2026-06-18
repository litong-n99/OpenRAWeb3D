/**
 * main.ts — 路由导航人工验收测试
 *
 * 测试目标:
 *   1. 验证 Router.on() 模式注册 + dispatch() 路径匹配 + navigate() 导航
 *   2. 验证真实 ModSelector.show() 和 ModSelector.launchMod() 集成
 *   3. 验证加载进度条动画（10% → 40% → 70% → 100%）
 *   4. 验证 Editor 占位页 + 未知路由处理
 *
 * OpenRA 对照: Router.ts — on(), dispatch(), navigate()
 *              ModSelector.ts — show(), launchMod(), hide()
 * Phase A — 纯 DOM，不依赖 @babylonjs/core
 *
 * 关键设计: 所有导航按钮通过 router.navigate() 触发，Router 内部调用
 * history.pushState() + dispatch()，route handlers 调用 ModSelector / Editor 渲染函数。
 * 这完整验证了 Router 的模式编译、参数提取、浏览器历史集成。
 */

import { Router } from '../../../../OpenRA.Game/Router.js'
import type { RouteHandler } from '../../../../OpenRA.Game/Router.js'
import { ModSelector } from '../../../../OpenRA.Game/ModSelector.js'

// ---------------------------------------------------------------------------
// Test route base — keeps browser URL under the test page prefix
// so pushState never navigates away from the test harness.
// ---------------------------------------------------------------------------

const TEST_BASE = '/test/ch22-game-entry/router-navigation'

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------

const container = document.getElementById('mod-selector')!
const loadingOverlay = document.getElementById('loading-overlay')!
const loadingBar = document.getElementById('loading-bar')!
const loadingTextEl = document.getElementById('loading-text')!

const urlPathEl = document.getElementById('url-path')!
const urlBadge = document.getElementById('url-badge')!
const urlBadgeUnmatch = document.getElementById('url-badge-unmatch')!

const statePath = document.getElementById('state-path')!
const stateRoute = document.getElementById('state-route')!
const stateParams = document.getElementById('state-params')!
const stateResult = document.getElementById('state-result')!
const stateProgress = document.getElementById('state-progress')!
const stateLoadtext = document.getElementById('state-loadtext')!

const infoUa = document.getElementById('info-ua')!
const infoViewport = document.getElementById('info-viewport')!
const infoTime = document.getElementById('info-time')!

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
// URL Bar + Route State display — driven by real window.location.pathname
// ---------------------------------------------------------------------------

function refreshUrlBar(): void {
  const p = window.location.pathname
  urlPathEl.textContent = p
  statePath.textContent = p
}

function showRouteMatched(pattern: string, params: Record<string, string>): void {
  urlBadge.style.display = 'inline-block'
  urlBadgeUnmatch.style.display = 'none'
  stateRoute.textContent = pattern
  stateParams.textContent = JSON.stringify(params)
  stateResult.textContent = 'MATCHED'
  stateResult.style.color = '#4caf50'
}

function showRouteUnmatched(): void {
  urlBadge.style.display = 'none'
  urlBadgeUnmatch.style.display = 'inline-block'
  stateRoute.textContent = '(none)'
  stateParams.textContent = '{}'
  stateResult.textContent = 'NO MATCH'
  stateResult.style.color = '#ef9a9a'
}

// ---------------------------------------------------------------------------
// Progress monitoring — polls ModSelector-managed elements
// ---------------------------------------------------------------------------

function syncProgressDisplay(): void {
  stateProgress.textContent = loadingBar.style.width || '0%'
  stateLoadtext.textContent = loadingTextEl.textContent || '-'
}

let progressInterval = 0
function startProgressSync(): void {
  if (progressInterval) return
  progressInterval = window.setInterval(syncProgressDisplay, 50)
}
function stopProgressSync(): void {
  if (progressInterval) {
    clearInterval(progressInterval)
    progressInterval = 0
  }
}

// ---------------------------------------------------------------------------
// Editor Stub (no ModSelector equivalent — Phase A only has inline handler)
// ---------------------------------------------------------------------------

/**
 * Renders the editor placeholder, mirroring src/main.ts editor route.
 *
 * NOTE: The production code in src/main.ts line 41 used innerHTML with
 * direct URL-param interpolation (`` ${params['modId']} ``), which was an XSS
 * vector. That was fixed in commit 8caac53 (textContent for user-controlled
 * params). This test page uses hardcoded modId values from buttons, so the
 * risk does not apply here, but the pattern matches production for visual
 * fidelity.
 */
function renderEditorStub(modId: string): void {
  container.style.display = 'none'
  loadingOverlay.style.display = 'none'

  const existing = document.querySelector('.editor-placeholder')
  if (existing) existing.remove()

  const placeholder = document.createElement('div')
  placeholder.className = 'editor-placeholder'

  const h1 = document.createElement('h1')
  h1.textContent = 'Editor'
  placeholder.appendChild(h1)

  const p = document.createElement('p')
  p.textContent = `Coming soon — ${modId} map editor`
  placeholder.appendChild(p)

  const a = document.createElement('a')
  a.textContent = 'Back to Mod Selector'
  a.addEventListener('click', (e) => {
    e.preventDefault()
    router.navigate(TEST_BASE + '/')
  })
  placeholder.appendChild(a)

  const appViewport = document.getElementById('app-viewport')!
  appViewport.appendChild(placeholder)
}

// ---------------------------------------------------------------------------
// Router Setup — the core of this test page
// ---------------------------------------------------------------------------

const router = new Router()

// Home route → ModSelector.show()
router.on(TEST_BASE + '/', (() => {
  const existing = document.querySelector('.editor-placeholder')
  if (existing) existing.remove()

  loadingOverlay.style.display = 'none'
  loadingBar.style.width = '0%'
  loadingTextEl.textContent = 'Loading...'

  container.style.display = ''
  ModSelector.show(container)

  refreshUrlBar()
  showRouteMatched(TEST_BASE + '/', {})
  stopProgressSync()
  syncProgressDisplay()
}) as RouteHandler)

// Play route → ModSelector.launchMod() — real progress bar animation
router.on(TEST_BASE + '/play/:modId', ((params: Record<string, string>) => {
  const existing = document.querySelector('.editor-placeholder')
  if (existing) existing.remove()

  refreshUrlBar()
  showRouteMatched(TEST_BASE + '/play/:modId', params)
  startProgressSync()

  // Delegates to real ModSelector.launchMod() which:
  //  1. Hides #mod-selector (display:none)
  //  2. Shows #loading-overlay (display:flex)
  //  3. Animates #loading-bar width and #loading-text via setTimeout chain
  ModSelector.launchMod(params['modId'])
}) as RouteHandler)

// Editor route → Editor placeholder
router.on(TEST_BASE + '/editor/:modId', ((params: Record<string, string>) => {
  refreshUrlBar()
  showRouteMatched(TEST_BASE + '/editor/:modId', params)
  stopProgressSync()

  renderEditorStub(params['modId'])
}) as RouteHandler)

// ---------------------------------------------------------------------------
// Navigation buttons — ALL use router.navigate() which calls
// history.pushState() + dispatch(), exercising the full Router API.
// ---------------------------------------------------------------------------

document.getElementById('btn-home')!.addEventListener('click', () => {
  router.navigate(TEST_BASE + '/')
})

document.getElementById('btn-play-ra')!.addEventListener('click', () => {
  router.navigate(TEST_BASE + '/play/ra')
})

document.getElementById('btn-play-td')!.addEventListener('click', () => {
  router.navigate(TEST_BASE + '/play/td')
})

document.getElementById('btn-editor')!.addEventListener('click', () => {
  router.navigate(TEST_BASE + '/editor/ra')
})

document.getElementById('btn-unknown')!.addEventListener('click', () => {
  router.navigate(TEST_BASE + '/unknown')
  // router.navigate() → pushState → dispatch()
  // dispatch() returns false for unmatched routes
  refreshUrlBar()
  showRouteUnmatched()
})

// ---------------------------------------------------------------------------
// Initial dispatch — matches TEST_BASE + '/' → ModSelector.show()
// ---------------------------------------------------------------------------

refreshUrlBar()
const initialMatch = router.dispatch()
if (!initialMatch) {
  // Fallback: if pathname isn't exactly the test base, force the home route
  router.navigate(TEST_BASE + '/')
}

// ---------------------------------------------------------------------------
// Test Harness
// ---------------------------------------------------------------------------

;(window as any).__testHarness = {
  router,
  getContainer: () => container,
  getLoadingBarWidth: () => loadingBar.style.width,
  getLoadingText: () => loadingTextEl.textContent,
  navigateHome: () => router.navigate(TEST_BASE + '/'),
  navigatePlay: (modId: string) => router.navigate(TEST_BASE + '/play/' + modId),
  navigateEditor: (modId: string) => router.navigate(TEST_BASE + '/editor/' + modId),
}

// ---------------------------------------------------------------------------
// Cleanup on page unload
// ---------------------------------------------------------------------------

window.addEventListener('beforeunload', () => {
  stopProgressSync()
  router.dispose()
})

if (import.meta.hot) {
  import.meta.hot.accept(() => {})
}
