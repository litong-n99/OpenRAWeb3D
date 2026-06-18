/**
 * main.ts — Mod 选择器首页人工验收测试
 *
 * 测试目标:
 *   1. 验证 ModSelector.show() 渲染 4 张 Mod 卡片
 *   2. 验证 "Coming Soon" 丝带仅在 TS 卡片显示
 *   3. 验证 Play 按钮仅出现在可用 Mod (RA, TD, D2K)
 *   4. 验证悬停动画效果（CSS transition）
 *   5. 验证阵营标签渲染
 *   6. 验证 hide() 清理行为
 *
 * OpenRA 对照: ModSelector.ts — show(), createModCard(), launchMod(), hide()
 * Phase A — 纯 DOM，不依赖 @babylonjs/core
 */

import { ModSelector } from '../../../../OpenRA.Game/ModSelector.js'

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------

const container = document.getElementById('mod-selector')!
const infoUa = document.getElementById('info-ua')!
const infoViewport = document.getElementById('info-viewport')!
const infoEngine = document.getElementById('info-engine')!
const infoTime = document.getElementById('info-time')!
const interactionLog = document.getElementById('interaction-log')!
const btnRefresh = document.getElementById('btn-refresh') as HTMLButtonElement
const btnHide = document.getElementById('btn-hide') as HTMLButtonElement

// Check indicators
const chkTitle = document.getElementById('chk-title')!
const chkCards = document.getElementById('chk-cards')!
const chkPlaybtns = document.getElementById('chk-playbtns')!
const chkRibbon = document.getElementById('chk-ribbon')!
const chkFactions = document.getElementById('chk-factions')!

// ---------------------------------------------------------------------------
// Info Bar
// ---------------------------------------------------------------------------

function updateInfoBar(): void {
  infoUa.textContent = navigator.userAgent.slice(0, 80)
  infoViewport.textContent = `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
  infoEngine.textContent = 'N/A (纯 DOM 测试，无 3D 引擎)'
  infoTime.textContent = new Date().toISOString()
}

window.addEventListener('resize', updateInfoBar)
updateInfoBar()

// ---------------------------------------------------------------------------
// Interaction Logging
// ---------------------------------------------------------------------------

function logInteraction(message: string): void {
  const now = new Date()
  const ts = now.toTimeString().slice(0, 8)
  const entry = document.createElement('div')
  entry.className = 'entry'
  entry.innerHTML = `<span class="ts">${ts}</span>${message}`
  interactionLog.insertBefore(entry, interactionLog.firstChild)
}

// ---------------------------------------------------------------------------
// Auto-verification helpers
// ---------------------------------------------------------------------------

function runAutoChecks(): void {
  // Check 1: Title rendered
  const headerH1 = container.querySelector('.mod-selector-header h1')
  const headerP = container.querySelector('.mod-selector-header p')
  if (headerH1?.textContent === 'OpenRAWeb3D' && headerP?.textContent === 'Select a mod to launch') {
    chkTitle.className = 'check-indicator pass'
    logInteraction('PASS: 标题 "OpenRAWeb3D" + 副标题渲染正确')
  } else {
    chkTitle.className = 'check-indicator fail'
    logInteraction(`FAIL: 标题不匹配 — H1="${headerH1?.textContent}", P="${headerP?.textContent}"`)
  }

  // Check 2: 4 cards
  const cards = container.querySelectorAll('.mod-card')
  if (cards.length === 4) {
    chkCards.className = 'check-indicator pass'
    logInteraction(`PASS: 卡片数量 = ${cards.length}`)
  } else {
    chkCards.className = 'check-indicator fail'
    logInteraction(`FAIL: 期望 4 张卡片，实际 ${cards.length}`)
  }

  // Check 3: Play buttons (3 for RA, TD, D2K)
  const playBtns = container.querySelectorAll('.mod-card-play-btn')
  if (playBtns.length === 3) {
    chkPlaybtns.className = 'check-indicator pass'
    logInteraction(`PASS: Play 按钮数量 = ${playBtns.length}`)
  } else {
    chkPlaybtns.className = 'check-indicator fail'
    logInteraction(`FAIL: 期望 3 个 Play 按钮，实际 ${playBtns.length}`)
  }

  // Check 4: Coming Soon ribbon (1 for TS)
  const ribbons = container.querySelectorAll('.mod-card-ribbon')
  if (ribbons.length === 1 && ribbons[0].textContent === 'Coming Soon') {
    chkRibbon.className = 'check-indicator pass'
    logInteraction('PASS: Coming Soon 丝带 = 1 (TS 卡片)')
  } else {
    chkRibbon.className = 'check-indicator fail'
    logInteraction(`FAIL: 期望 1 个 Coming Soon 丝带，实际 ${ribbons.length}`)
  }

  // Check 5: Faction tags (Soviet + Allies + GDI + Nod + Atreides + Harkonnen + Ordos + GDI + Nod = 9)
  const tags = container.querySelectorAll('.mod-card-faction-tag')
  if (tags.length === 9) {
    chkFactions.className = 'check-indicator pass'
    const tagTexts = Array.from(tags).map(t => t.textContent).join(', ')
    logInteraction(`PASS: 阵营标签数量 = ${tags.length} — ${tagTexts}`)
  } else {
    chkFactions.className = 'check-indicator fail'
    logInteraction(`FAIL: 期望 9 个阵营标签，实际 ${tags.length}`)
  }
}

// ---------------------------------------------------------------------------
// Hover tracking
// ---------------------------------------------------------------------------

function attachHoverTracking(): void {
  const cards = container.querySelectorAll('.mod-card')
  cards.forEach((card) => {
    const modId = card.getAttribute('data-mod-id') || 'unknown'
    card.addEventListener('mouseenter', () => {
      const title = card.querySelector('.mod-card-title')?.textContent || modId
      logInteraction(`悬停: ${title} (${modId})${card.classList.contains('unavailable') ? ' [不可用]' : ''}`)
    })
  })

  // Track Play button clicks
  const playBtns = container.querySelectorAll('.mod-card-play-btn')
  playBtns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest('.mod-card')
      const modId = card?.getAttribute('data-mod-id') || 'unknown'
      const title = card?.querySelector('.mod-card-title')?.textContent || modId
      logInteraction(`点击 Play →: ${title} (${modId}) — 将触发 launchMod()`)
    })
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  logInteraction('初始化 Mod 选择器...')

  try {
    await ModSelector.show(container)
    logInteraction('ModSelector.show() 完成')
  } catch (err) {
    logInteraction(`ERROR: ModSelector.show() 失败 — ${err instanceof Error ? err.message : String(err)}`)
    return
  }

  // Run automated checks
  runAutoChecks()

  // Attach hover tracking
  attachHoverTracking()
}

// ---------------------------------------------------------------------------
// Button handlers
// ---------------------------------------------------------------------------

btnRefresh.addEventListener('click', async () => {
  logInteraction('手动刷新 Mod 选择器...')
  // Reset check indicators
  chkTitle.className = 'check-indicator'
  chkCards.className = 'check-indicator'
  chkPlaybtns.className = 'check-indicator'
  chkRibbon.className = 'check-indicator'
  chkFactions.className = 'check-indicator'

  try {
    await ModSelector.show(container)
    logInteraction('刷新完成')
    runAutoChecks()
    attachHoverTracking()
  } catch (err) {
    logInteraction(`ERROR: 刷新失败 — ${err instanceof Error ? err.message : String(err)}`)
  }
})

btnHide.addEventListener('click', () => {
  logInteraction('调用 ModSelector.hide() — 清理所有内容')
  ModSelector.hide()
  // Reset check indicators
  chkTitle.className = 'check-indicator'
  chkCards.className = 'check-indicator'
  chkPlaybtns.className = 'check-indicator'
  chkRibbon.className = 'check-indicator'
  chkFactions.className = 'check-indicator'

  // Verify container is empty
  if (container.innerHTML === '') {
    logInteraction('PASS: hide() 后容器内容为空')
  } else {
    logInteraction('FAIL: hide() 后容器仍有内容')
  }

  // Check loading overlay hidden
  const overlay = document.getElementById('loading-overlay')!
  if (overlay.style.display === 'none') {
    logInteraction('PASS: loading-overlay 已隐藏')
  } else {
    logInteraction(`WARN: loading-overlay display = ${overlay.style.display}`)
  }
})

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err: unknown) => {
  logInteraction(`FATAL: ${err instanceof Error ? err.message : String(err)}`)
  console.error('[mod-selector test] main() failed:', err)
})

// ---------------------------------------------------------------------------
// Test harness export
// ---------------------------------------------------------------------------

;(window as any).__testHarness = {
  getContainer: () => container,
  getCards: () => container.querySelectorAll('.mod-card'),
  getPlayButtons: () => container.querySelectorAll('.mod-card-play-btn'),
  getRibbons: () => container.querySelectorAll('.mod-card-ribbon'),
  getFactionTags: () => container.querySelectorAll('.mod-card-faction-tag'),
  refresh: () => { btnRefresh.click() },
  hide: () => { btnHide.click() },
  getInteractionLog: () => interactionLog.textContent,
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {})
}
