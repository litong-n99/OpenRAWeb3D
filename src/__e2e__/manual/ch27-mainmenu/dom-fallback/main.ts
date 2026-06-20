/**
 * main.ts — DOM 覆盖层回退人工验收测试
 *
 * 测试目标:
 *   1. 验证 Game._showMainMenuDomOverlay() 的完整 DOM 结构
 *   2. 验证所有样式属性匹配 Game.ts 中的定义
 *   3. 验证按钮 hover 效果（渐变背景色变化）
 *   4. 验证 disabled 按钮状态
 *   5. 验证版本文字 pulse 动画
 *   6. 验证 Shellmap 回退背景色
 *
 * OpenRA 对照: Game.ts — _showMainMenuDomOverlay() (lines 1219-1347)
 *              Game.ts — setShellmapFallback() (Color4: 0.05, 0.05, 0.1, 1.0)
 *
 * 设计说明:
 *   本测试页面完整复制 Game._showMainMenuDomOverlay() 中的 DOM 创建逻辑，
 *   以验证 DOM 覆盖层在 Widget 系统不可用时的表现。作为 ADR-27.1 的回退方案，
 *   DOM 覆盖层必须样式正确、按钮可交互、在 Widget 失败时始终可用。
 */

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------

const sandbox = document.getElementById('sandbox')!
const interactionLog = document.getElementById('interaction-log')!
const bgColorVal = document.getElementById('bg-color-val')!

const infoUa = document.getElementById('info-ua')!
const infoViewport = document.getElementById('info-viewport')!
const infoTime = document.getElementById('info-time')!

// Check indicators
const chkOverlayExists = document.getElementById('chk-overlay-exists')!
const chkTitle = document.getElementById('chk-title')!
const chkSubtitle = document.getElementById('chk-subtitle')!
const chkButtonsCount = document.getElementById('chk-buttons-count')!
const chkBtnSkirmish = document.getElementById('chk-btn-skirmish')!
const chkBtnMultiplayer = document.getElementById('chk-btn-multiplayer')!
const chkBtnSettings = document.getElementById('chk-btn-settings')!
const chkBtnExit = document.getElementById('chk-btn-exit')!
const chkVersion = document.getElementById('chk-version')!

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
// Interaction Logging
// ---------------------------------------------------------------------------

function logInteraction(message: string, type: 'info' | 'click' | 'hover' | 'error' = 'info'): void {
  const now = new Date()
  const ts = now.toTimeString().slice(0, 8)
  const colors: Record<string, string> = {
    info: '#888',
    click: '#4caf50',
    hover: '#88aaff',
    error: '#e94560',
  }
  const color = colors[type]
  const line = document.createElement('div')
  line.innerHTML = `<span style="color:#444">${ts}</span> <span style="color:${color}">[${type}]</span> ${message}`
  interactionLog.insertBefore(line, interactionLog.firstChild)

  // Keep max 50 lines
  while (interactionLog.children.length > 50) {
    interactionLog.removeChild(interactionLog.lastChild!)
  }
}

// ---------------------------------------------------------------------------
// DOM Overlay Creation (exact replica of Game._showMainMenuDomOverlay())
// ---------------------------------------------------------------------------

/**
 * Creates the DOM overlay EXACTLY as Game._showMainMenuDomOverlay() does.
 * Every style string, every element ID, every CSS value is copied verbatim.
 */
function createDomOverlay(): HTMLElement {
  const overlay = document.createElement('div')
  overlay.id = 'main-menu-overlay'
  overlay.style.cssText =
    'position:fixed;inset:0;display:flex;flex-direction:column;' +
    'align-items:center;justify-content:center;z-index:99;' +
    'pointer-events:none;'

  // Menu card
  const menu = document.createElement('div')
  menu.style.cssText =
    'pointer-events:auto;text-align:center;' +
    'background:rgba(10,10,30,0.75);border:1px solid rgba(100,100,180,0.3);' +
    'border-radius:12px;padding:3rem 4rem;min-width:360px;'

  // Title
  const title = document.createElement('h1')
  title.textContent = 'OpenRAWeb3D'
  title.style.cssText =
    'color:#f0f0f0;font-size:2rem;font-weight:700;margin-bottom:0.5rem;' +
    'letter-spacing:-0.5px;'
  menu.appendChild(title)

  // Subtitle
  const subtitle = document.createElement('p')
  subtitle.textContent = 'Web-based RTS Engine'
  subtitle.style.cssText = 'color:#8888aa;font-size:0.9rem;margin-bottom:2rem;'
  menu.appendChild(subtitle)

  // Buttons (exact same definition as Game.ts)
  interface MenuButton {
    id: string
    text: string
    disabled: boolean
    onClick: () => void
  }

  const buttons: MenuButton[] = [
    {
      id: 'btn-skirmish',
      text: 'Skirmish',
      disabled: false,
      onClick: () => logInteraction('Skirmish 按钮被点击 → _openSkirmishSetup()', 'click'),
    },
    {
      id: 'btn-multiplayer',
      text: 'Multiplayer (Coming Soon)',
      disabled: true,
      onClick: () => {},
    },
    {
      id: 'btn-settings',
      text: 'Settings',
      disabled: false,
      onClick: () => logInteraction('Settings 按钮被点击 → _openSettingsPanel()', 'click'),
    },
    {
      id: 'btn-exit',
      text: 'Exit to Desktop',
      disabled: false,
      onClick: () => logInteraction('Exit 按钮被点击 → _exitToModSelector()', 'click'),
    },
  ]

  for (const btnDef of buttons) {
    const btn = document.createElement('button')
    btn.id = btnDef.id
    btn.textContent = btnDef.text
    btn.disabled = btnDef.disabled
    btn.style.cssText =
      'display:block;width:100%;padding:12px 20px;margin-bottom:12px;' +
      'border:1px solid rgba(100,100,180,0.4);border-radius:6px;' +
      'font-size:1rem;font-weight:600;cursor:pointer;transition:all 0.15s ease;' +
      (
        btnDef.disabled
          ? 'background:rgba(40,40,60,0.5);color:#555570;cursor:not-allowed;'
          : 'background:linear-gradient(135deg,#334488,#4466cc);color:#e0e0f0;'
      )

    if (!btnDef.disabled) {
      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'linear-gradient(135deg,#4466cc,#5577ee)'
        btn.style.borderColor = 'rgba(120,140,220,0.6)'
        btn.style.boxShadow = '0 0 8px rgba(100,140,220,0.3)'
        logInteraction(`${btnDef.text} — hover enter（背景变亮、边框高亮、辉光出现）`, 'hover')
      })
      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'linear-gradient(135deg,#334488,#4466cc)'
        btn.style.borderColor = 'rgba(100,100,180,0.4)'
        btn.style.boxShadow = 'none'
        logInteraction(`${btnDef.text} — hover leave（恢复常态）`, 'hover')
      })
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        btnDef.onClick()
      })
    }
    menu.appendChild(btn)
  }

  // Version text with pulse animation
  const version = document.createElement('p')
  version.textContent = 'Prototype — Phase C'
  version.style.cssText =
    'color:#555570;font-size:0.75rem;margin-top:1.5rem;' +
    'animation:menu-version-pulse 3s ease-in-out infinite;'
  menu.appendChild(version)

  // Inject pulse keyframes + focus-visible styles
  if (!document.getElementById('menu-version-pulse-style')) {
    const style = document.createElement('style')
    style.id = 'menu-version-pulse-style'
    style.textContent =
      '@keyframes menu-version-pulse {' +
      '0%, 100% { opacity: 0.4; }' +
      '50% { opacity: 0.8; }' +
      '}' +
      '#main-menu-overlay button:focus-visible {' +
      'outline:2px solid rgba(120,140,220,0.8);' +
      'outline-offset:2px;' +
      '}'
    document.head.appendChild(style)
  }

  overlay.appendChild(menu)
  return overlay
}

// ---------------------------------------------------------------------------
// Show / Hide
// ---------------------------------------------------------------------------

let _currentOverlay: HTMLElement | null = null

function showOverlay(): void {
  // Remove existing overlay first (prevent duplicates)
  removeOverlay()

  _currentOverlay = createDomOverlay()
  // Attach to sandbox as a fixed-positioned element (simulates being on top of canvas)
  sandbox.appendChild(_currentOverlay)

  logInteraction('DOM 覆盖层已显示（模拟 Widget 加载失败后的回退）', 'info')
  runAutoChecks()
}

function removeOverlay(): void {
  const existing = document.getElementById('main-menu-overlay')
  if (existing) {
    existing.remove()
    _currentOverlay = null
    logInteraction('DOM 覆盖层已移除', 'info')
  }
  // Reset checks
  const allIndicators = [
    chkOverlayExists, chkTitle, chkSubtitle, chkButtonsCount,
    chkBtnSkirmish, chkBtnMultiplayer, chkBtnSettings, chkBtnExit, chkVersion,
  ]
  for (const ind of allIndicators) {
    ind.className = 'check-indicator'
  }
}

function simulateWidgetFailure(): void {
  logInteraction('模拟: WidgetLoader 加载失败 → 回退到 DOM 覆盖层', 'error')
  // Small delay to simulate the async widget load attempt
  setTimeout(() => {
    showOverlay()
    logInteraction('回退完成: DOM 覆盖层已显示（ADR-27.1 回退方案生效）', 'info')
  }, 500)
}

// ---------------------------------------------------------------------------
// Auto-checks
// ---------------------------------------------------------------------------

function runAutoChecks(): void {
  const overlay = document.getElementById('main-menu-overlay')

  // Check 1: Overlay exists
  chkOverlayExists.className = overlay ? 'check-indicator pass' : 'check-indicator fail'

  if (!overlay) {
    // All other checks fail
    for (const ind of [chkTitle, chkSubtitle, chkButtonsCount, chkBtnSkirmish, chkBtnMultiplayer, chkBtnSettings, chkBtnExit, chkVersion]) {
      ind.className = 'check-indicator fail'
    }
    return
  }

  // Check 2: Title text
  const titleEl = overlay.querySelector('h1')
  chkTitle.className =
    titleEl && titleEl.textContent === 'OpenRAWeb3D' ? 'check-indicator pass' : 'check-indicator fail'

  // Check 3: Subtitle text
  // NOTE: This querySelector('p') relies on DOM insertion order — the subtitle <p>
  // is the first <p> child appended to the menu card (before button elements).
  // If the DOM structure changes, this selector must be updated to a more specific one.
  const subtitleEl = overlay.querySelector('p')
  chkSubtitle.className =
    subtitleEl && subtitleEl.textContent === 'Web-based RTS Engine'
      ? 'check-indicator pass'
      : 'check-indicator fail'

  // Check 4: Button count (at least 3: Skirmish, Settings, Exit, + 1 disabled Multiplayer)
  const allButtons = overlay.querySelectorAll('button')
  chkButtonsCount.className = allButtons.length >= 4 ? 'check-indicator pass' : 'check-indicator fail'

  // Check 5: Skirmish button exists and is enabled
  const skirmishBtn = overlay.querySelector('#btn-skirmish') as HTMLButtonElement | null
  chkBtnSkirmish.className =
    skirmishBtn && !skirmishBtn.disabled ? 'check-indicator pass' : 'check-indicator fail'

  // Check 6: Multiplayer button is disabled
  const multiplayerBtn = overlay.querySelector('#btn-multiplayer') as HTMLButtonElement | null
  chkBtnMultiplayer.className =
    multiplayerBtn && multiplayerBtn.disabled ? 'check-indicator pass' : 'check-indicator fail'

  // Check 7: Settings button exists
  const settingsBtn = overlay.querySelector('#btn-settings') as HTMLButtonElement | null
  chkBtnSettings.className =
    settingsBtn && !settingsBtn.disabled ? 'check-indicator pass' : 'check-indicator fail'

  // Check 8: Exit button exists
  const exitBtn = overlay.querySelector('#btn-exit') as HTMLButtonElement | null
  chkBtnExit.className =
    exitBtn && !exitBtn.disabled ? 'check-indicator pass' : 'check-indicator fail'

  // Check 9: Version text exists
  const versionElements = overlay.querySelectorAll('p')
  let versionFound = false
  for (const el of versionElements) {
    if (el.textContent?.includes('Prototype — Phase C')) {
      versionFound = true
      break
    }
  }
  chkVersion.className = versionFound ? 'check-indicator pass' : 'check-indicator fail'
}

// ---------------------------------------------------------------------------
// Shellmap background color
// ---------------------------------------------------------------------------

function setShellmapBackground(): void {
  // Exact match: Game.setShellmapFallback() → clearColor = Color4(0.05, 0.05, 0.1, 1.0)
  sandbox.style.backgroundColor = '#0d0d1a'
  bgColorVal.textContent = 'rgb(13,13,26) #0d0d1a'
}

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------

document.getElementById('btn-show-overlay')!.addEventListener('click', () => {
  showOverlay()
})

document.getElementById('btn-remove-overlay')!.addEventListener('click', () => {
  removeOverlay()
})

document.getElementById('btn-simulate-fallback')!.addEventListener('click', () => {
  removeOverlay()
  simulateWidgetFailure()
})

// ---------------------------------------------------------------------------
// Apply exact sandbox background color on load
// ---------------------------------------------------------------------------

setShellmapBackground()

// ---------------------------------------------------------------------------
// Keyboard: Escape to remove overlay
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    removeOverlay()
    logInteraction('Escape 键 — 移除 DOM 覆盖层', 'info')
  }
})

// ---------------------------------------------------------------------------
// Test Harness
// ---------------------------------------------------------------------------

// Expose test harness for Playwright/automated testing
;(window as any).__testHarness = {
  showOverlay: () => showOverlay(),
  removeOverlay: () => removeOverlay(),
  simulateWidgetFailure: () => simulateWidgetFailure(),
  getOverlay: () => document.getElementById('main-menu-overlay'),
  getCheckResults: () => ({
    overlayExists: chkOverlayExists.className.includes('pass'),
    title: chkTitle.className.includes('pass'),
    subtitle: chkSubtitle.className.includes('pass'),
    buttonsCount: chkButtonsCount.className.includes('pass'),
    btnSkirmish: chkBtnSkirmish.className.includes('pass'),
    btnMultiplayer: chkBtnMultiplayer.className.includes('pass'),
    btnSettings: chkBtnSettings.className.includes('pass'),
    btnExit: chkBtnExit.className.includes('pass'),
    version: chkVersion.className.includes('pass'),
  }),
  getLogEntries: () => interactionLog.children.length,
  getSandboxBg: () => getComputedStyle(sandbox).backgroundColor,
}

// ---------------------------------------------------------------------------
// Auto-show overlay on load
// ---------------------------------------------------------------------------

logInteraction('页面已就绪。快捷键: Escape = 移除覆盖层', 'info')
showOverlay()

if (import.meta.hot) {
  import.meta.hot.accept(() => {})
}
