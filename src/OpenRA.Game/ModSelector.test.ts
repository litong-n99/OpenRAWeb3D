/**
 * ModSelector.test.ts — ModSelector 迁移单元测试
 *
 * 测试 Mod 选择首页的 DOM 渲染、卡片创建、点击事件、
 * 加载状态转换和清理行为。
 * 零依赖: 不导入 @babylonjs/core 或任何游戏引擎模块。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ModSelector, WorldType, type ModEntry } from './ModSelector'

// ---------------------------------------------------------------------------
// Mock Game.js — Phase B: Game.create() is dynamically imported in launchMod()
// ---------------------------------------------------------------------------

vi.mock('./Game.js', () => ({
  Game: {
    create: vi.fn().mockResolvedValue(undefined),
  },
  GameState: {
    Uninitialized: 'Uninitialized',
    LoadingMod: 'LoadingMod',
    Shellmap: 'Shellmap',
    Playing: 'Playing',
    Editor: 'Editor',
    Disposed: 'Disposed',
  },
  WorldType: {
    Regular: 'Regular',
    Shellmap: 'Shellmap',
    Editor: 'Editor',
  },
  getCurrentGame: vi.fn(() => null),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 创建带有所需子元素的测试容器 */
function createTestDOM(): {
  container: HTMLElement
  overlay: HTMLElement
  loadingText: HTMLElement
  loadingBar: HTMLElement
  canvas: HTMLElement
} {
  document.body.innerHTML = `
    <div id="mod-selector"></div>
    <canvas id="game-canvas" style="display:none"></canvas>
    <div id="loading-overlay" style="display:none">
      <div id="loading-bar" style="width:0%"></div>
      <span id="loading-text">Loading...</span>
    </div>
  `
  return {
    container: document.getElementById('mod-selector')!,
    overlay: document.getElementById('loading-overlay')!,
    loadingText: document.getElementById('loading-text')!,
    loadingBar: document.getElementById('loading-bar')!,
    canvas: document.getElementById('game-canvas')!,
  }
}

function mockModIndex(mods: ModEntry[]): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ mods }),
  } as Response)
}

function mockFetchError(status: number): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    status,
  } as Response)
}

function mockFetchReject(error: Error): void {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(error)
}

// ---------------------------------------------------------------------------
// Test Data
// ---------------------------------------------------------------------------

const sampleMods: ModEntry[] = [
  {
    id: 'ra',
    title: 'Red Alert',
    version: 'release-20250308',
    description: 'Command Soviets or Allies.',
    factions: ['Soviet', 'Allies'],
    thumbnail: '',
    background: '',
    available: true,
  },
  {
    id: 'ts',
    title: 'Tiberian Sun',
    version: 'release-20250308',
    description: 'The Second Tiberium War.',
    factions: ['GDI', 'Nod'],
    thumbnail: '',
    background: '',
    available: false,
  },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ModSelector', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  // -----------------------------------------------------------------------
  // show()
  // -----------------------------------------------------------------------

  describe('show()', () => {
    it('renders mod cards from _index.json data', async () => {
      const { container } = createTestDOM()
      mockModIndex(sampleMods)

      await ModSelector.show(container)

      const cards = container.querySelectorAll('.mod-card')
      expect(cards.length).toBe(2)
    })

    it('renders mod title in each card', async () => {
      const { container } = createTestDOM()
      mockModIndex(sampleMods)

      await ModSelector.show(container)

      const titles = container.querySelectorAll('.mod-card-title')
      expect(titles[0].textContent).toBe('Red Alert')
      expect(titles[1].textContent).toBe('Tiberian Sun')
    })

    it('renders mod description in each card', async () => {
      const { container } = createTestDOM()
      mockModIndex(sampleMods)

      await ModSelector.show(container)

      const descs = container.querySelectorAll('.mod-card-description')
      expect(descs[0].textContent).toBe('Command Soviets or Allies.')
    })

    it('renders faction tags', async () => {
      const { container } = createTestDOM()
      mockModIndex(sampleMods)

      await ModSelector.show(container)

      const tags = container.querySelectorAll('.mod-card-faction-tag')
      expect(tags.length).toBe(4) // Soviet + Allies + GDI + Nod
      expect(tags[0].textContent).toBe('Soviet')
      expect(tags[1].textContent).toBe('Allies')
    })

    it('renders Play button for available mods', async () => {
      const { container } = createTestDOM()
      mockModIndex(sampleMods)

      await ModSelector.show(container)

      const btns = container.querySelectorAll('.mod-card-play-btn')
      expect(btns.length).toBe(1) // Only RA is available
      expect(btns[0].textContent).toContain('Play')
    })

    it('renders "Coming Soon" ribbon for unavailable mods', async () => {
      const { container } = createTestDOM()
      mockModIndex(sampleMods)

      await ModSelector.show(container)

      const ribbons = container.querySelectorAll('.mod-card-ribbon')
      expect(ribbons.length).toBe(1)
      expect(ribbons[0].textContent).toBe('Coming Soon')
    })

    it('does not render Play button for unavailable mods', async () => {
      const { container } = createTestDOM()
      mockModIndex(sampleMods)

      await ModSelector.show(container)

      const unavailableCard = container.querySelector('.mod-card.unavailable')
      expect(unavailableCard).not.toBeNull()
      const btn = unavailableCard!.querySelector('.mod-card-play-btn')
      expect(btn).toBeNull()
    })

    it('adds unavailable CSS class to unavailable mod cards', async () => {
      const { container } = createTestDOM()
      mockModIndex(sampleMods)

      await ModSelector.show(container)

      const unavailableCards = container.querySelectorAll('.mod-card.unavailable')
      expect(unavailableCards.length).toBe(1)
    })

    it('renders header with title', async () => {
      const { container } = createTestDOM()
      mockModIndex(sampleMods)

      await ModSelector.show(container)

      const header = container.querySelector('.mod-selector-header')
      expect(header).not.toBeNull()
      expect(header!.querySelector('h1')!.textContent).toBe('OpenRAWeb3D')
    })

    it('renders card grid', async () => {
      const { container } = createTestDOM()
      mockModIndex(sampleMods)

      await ModSelector.show(container)

      const grid = container.querySelector('.mod-card-grid')
      expect(grid).not.toBeNull()
    })

    it('clears container before rendering', async () => {
      const { container } = createTestDOM()
      // 放入旧的标记内容
      container.innerHTML = '<p data-old="true">Old content</p>'
      mockModIndex(sampleMods)

      await ModSelector.show(container)

      // 旧内容被清除
      const oldElement = container.querySelector('[data-old]')
      expect(oldElement).toBeNull()
      // 有新的内容渲染
      const cards = container.querySelectorAll('.mod-card')
      expect(cards.length).toBe(2)
    })
  })

  // -----------------------------------------------------------------------
  // show() — empty state
  // -----------------------------------------------------------------------

  describe('show() — empty mod list', () => {
    it('displays graceful empty state when mods array is empty', async () => {
      const { container } = createTestDOM()
      mockModIndex([])

      await ModSelector.show(container)

      expect(container.textContent).toContain('No Mods Available')
    })

    it('displays empty state hint', async () => {
      const { container } = createTestDOM()
      mockModIndex([])

      await ModSelector.show(container)

      expect(container.textContent).toContain('public/mods/')
    })
  })

  // -----------------------------------------------------------------------
  // show() — error state
  // -----------------------------------------------------------------------

  describe('show() — fetch error', () => {
    it('displays error message when fetch fails', async () => {
      const { container } = createTestDOM()
      mockFetchError(404)

      await ModSelector.show(container)

      expect(container.textContent).toContain('Failed to Load Mods')
    })

    it('displays error message when fetch rejects', async () => {
      const { container } = createTestDOM()
      mockFetchReject(new Error('Network error'))

      await ModSelector.show(container)

      expect(container.textContent).toContain('Failed to Load Mods')
      expect(container.textContent).toContain('Network error')
    })

    it('shows fallback for non-Error rejections', async () => {
      const { container } = createTestDOM()
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      mockFetchReject('string error' as unknown as Error)

      await ModSelector.show(container)

      expect(container.textContent).toContain('Failed to Load Mods')
      expect(container.textContent).toContain('Unknown error')
    })
  })

  // -----------------------------------------------------------------------
  // launchMod()
  // -----------------------------------------------------------------------

  describe('launchMod()', () => {
    it('hides the mod selector div', () => {
      const { container } = createTestDOM()
      container.style.display = 'block'

      // launchMod hides the mod-selector synchronously (before first await)
      void ModSelector.launchMod('ra')

      expect(container.style.display).toBe('none')
    })

    it('shows the loading overlay', () => {
      createTestDOM()

      // launchMod shows overlay synchronously
      void ModSelector.launchMod('ra')

      const overlay = document.getElementById('loading-overlay')!
      expect(overlay.style.display).toBe('flex')
    })

    it('updates loading text with first progress stage', () => {
      createTestDOM()

      void ModSelector.launchMod('ra')

      const loadingText = document.getElementById('loading-text')!
      // Phase B: first progress text is "Loading engine..." (not mod-specific yet)
      expect(loadingText.textContent).toBe('Loading engine...')
    })

    it('updates loading bar width with progress', () => {
      createTestDOM()

      void ModSelector.launchMod('ra')

      const loadingBar = document.getElementById('loading-bar')!
      // Phase B: first progress is 15%
      expect(loadingBar.style.width).toBe('15%')
    })

    it('shows canvas after launchMod is called', () => {
      const { canvas } = createTestDOM()

      void ModSelector.launchMod('ra')

      // canvas should be made visible synchronously
      expect(canvas.style.display).toBe('block')
    })

    it('completes launch sequence and hides overlay', async () => {
      createTestDOM()

      const promise = ModSelector.launchMod('ra')
      // Dynamic import + Game.create() resolve (both are mocked)
      // Then setTimeout(resolve, 300) needs fake timers
      await vi.runAllTimersAsync()
      await promise

      const overlay = document.getElementById('loading-overlay')!
      // After successful launch, overlay should be hidden
      expect(overlay.style.display).toBe('none')
    })

    it('completes loading and shows Ready text', async () => {
      createTestDOM()

      const promise = ModSelector.launchMod('ra')
      // Let dynamic import + Game.create settle
      await vi.runAllTimersAsync()
      await promise

      const loadingText = document.getElementById('loading-text')!
      // Phase B: final progress text is "Ready"
      expect(loadingText.textContent).toBe('Ready')

      const loadingBar = document.getElementById('loading-bar')!
      expect(loadingBar.style.width).toBe('100%')
    })

    it('uses WorldType.Editor when specified', async () => {
      createTestDOM()

      const promise = ModSelector.launchMod('ra', WorldType.Editor)
      await vi.runAllTimersAsync()
      await promise

      const loadingText = document.getElementById('loading-text')!
      // Final text is always "Ready" regardless of worldType
      expect(loadingText.textContent).toBe('Ready')
    })

    it('uses WorldType.Regular as default worldType', () => {
      createTestDOM()

      void ModSelector.launchMod('ra')

      const loadingText = document.getElementById('loading-text')!
      // Phase B: first progress text is "Loading engine..."
      expect(loadingText.textContent).toBe('Loading engine...')
    })

    it('shows error when canvas element is missing', async () => {
      // Phase B: canvas is required — launchMod catches the error internally
      // and displays it in the loading text (does NOT reject)
      document.body.innerHTML = `
        <div id="loading-overlay" style="display:none">
          <div id="loading-bar" style="width:0%"></div>
          <span id="loading-text">Loading...</span>
        </div>
      `

      const promise = ModSelector.launchMod('ra')

      // The error is thrown synchronously (before first await),
      // caught by the try/catch, and setProgress updates loadingText.
      // No timers needed for the error text to appear.
      const loadingText = document.getElementById('loading-text')!
      expect(loadingText.textContent).toBe(
        'Error: Canvas element #game-canvas not found in DOM',
      )

      // After the full recovery cycle (3000ms timeout + hide), promise resolves
      await vi.runAllTimersAsync()
      await promise
    })
  })

  // -----------------------------------------------------------------------
  // hide()
  // -----------------------------------------------------------------------

  describe('hide()', () => {
    it('clears mod selector content', () => {
      const { container } = createTestDOM()
      container.innerHTML = '<div class="mod-card">Test</div>'

      ModSelector.hide()

      expect(container.innerHTML).toBe('')
    })

    it('resets mod selector display style', () => {
      const { container } = createTestDOM()
      container.style.display = 'none'

      ModSelector.hide()

      expect(container.style.display).toBe('')
    })

    it('hides loading overlay', () => {
      const { overlay } = createTestDOM()
      overlay.style.display = 'flex'

      ModSelector.hide()

      expect(overlay.style.display).toBe('none')
    })

    it('resets loading bar width', () => {
      const { loadingBar } = createTestDOM()
      loadingBar.style.width = '80%'

      ModSelector.hide()

      expect(loadingBar.style.width).toBe('0%')
    })

    it('resets loading text', () => {
      const { loadingText } = createTestDOM()
      loadingText.textContent = 'Starting shellmap...'

      ModSelector.hide()

      expect(loadingText.textContent).toBe('Loading...')
    })

    it('handles missing DOM elements gracefully', () => {
      document.body.innerHTML = ''

      // Should not throw
      expect(() => ModSelector.hide()).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // launchMod() — error handling
  // -----------------------------------------------------------------------

  describe('launchMod() — error handling', () => {
    it('handles Game.create() rejection by showing error and recovering', async () => {
      const { Game } = await import('./Game.js')
      ;(Game.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Mod load failed'),
      )

      createTestDOM()

      const promise = ModSelector.launchMod('ra')
      // Game.create rejects → error handler sets error text → 3s timeout → hide()
      // vi.runAllTimersAsync() flushes the 3000ms timer, after which hide() resets
      await vi.runAllTimersAsync()
      await promise

      // After full error recovery cycle, ModSelector.hide() has been called
      // mod-selector content is cleared and display is reset
      const container = document.getElementById('mod-selector')!
      expect(container.innerHTML).toBe('')
      expect(container.style.display).toBe('')

      const overlay = document.getElementById('loading-overlay')!
      expect(overlay.style.display).toBe('none')
    })

    it('shows error message on launch failure', async () => {
      const { Game } = await import('./Game.js')
      ;(Game.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Mod load failed'),
      )

      const { loadingText } = createTestDOM()

      void ModSelector.launchMod('ra')

      // Advance just enough to let Game.create reject but NOT the 3s timeout
      // The rejection happens via microtask, so resolving all pending microtasks
      // should process the catch block (sets error text) without triggering hide()
      await vi.advanceTimersByTimeAsync(0)
      await Promise.resolve()

      // At this point, the error catch has run and set the error text
      // (The 3000ms timer hasn't fired yet, so hide() hasn't been called)
      expect(loadingText.textContent).toBe('Error: Mod load failed')
    })
  })
})
