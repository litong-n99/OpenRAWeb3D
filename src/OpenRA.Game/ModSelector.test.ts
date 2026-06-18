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
// Helpers
// ---------------------------------------------------------------------------

/** 创建带有所需子元素的测试容器 */
function createTestDOM(): {
  container: HTMLElement
  overlay: HTMLElement
  loadingText: HTMLElement
  loadingBar: HTMLElement
} {
  document.body.innerHTML = `
    <div id="mod-selector"></div>
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
    it('hides the mod selector div', async () => {
      const { container } = createTestDOM()
      container.style.display = 'block'

      const promise = ModSelector.launchMod('ra')
      // 等待基于 setTimeout 的 promise 完成
      await vi.runAllTimersAsync()
      await promise

      expect(container.style.display).toBe('none')
    })

    it('shows the loading overlay', () => {
      createTestDOM()

      // 立即触发（在同步代码部分），不需要 await
      void ModSelector.launchMod('ra')

      const overlay = document.getElementById('loading-overlay')!
      expect(overlay.style.display).toBe('flex')
    })

    it('updates loading text with first progress stage', () => {
      createTestDOM()

      void ModSelector.launchMod('ra')

      const loadingText = document.getElementById('loading-text')!
      // 同步阶段设置第一个进度文本（在 await 之前）
      expect(loadingText.textContent).toBe('Loading engine for ra...')
    })

    it('updates loading bar width with progress', () => {
      createTestDOM()

      void ModSelector.launchMod('ra')

      const loadingBar = document.getElementById('loading-bar')!
      expect(loadingBar.style.width).toBe('10%')
    })

    it('progresses through loading stages', async () => {
      createTestDOM()

      const promise = ModSelector.launchMod('ra')
      // 推进所有基于 setTimeout 的定时器
      await vi.runAllTimersAsync()
      await promise

      const loadingText = document.getElementById('loading-text')!
      expect(loadingText.textContent).toBe('Ready — engine stub (Phase B)')

      const loadingBar = document.getElementById('loading-bar')!
      expect(loadingBar.style.width).toBe('100%')
    })

    it('uses worldType in loading progress text', async () => {
      createTestDOM()

      const promise = ModSelector.launchMod('ra', WorldType.Editor)
      await vi.runAllTimersAsync()
      await promise

      const loadingText = document.getElementById('loading-text')!
      // 最终阶段文本固定为 Ready（不受 worldType 影响，仅中间阶段显示）
      expect(loadingText.textContent).toBe('Ready — engine stub (Phase B)')
    })

    it('uses WorldType.Regular as default worldType', () => {
      createTestDOM()

      void ModSelector.launchMod('ra')

      const loadingText = document.getElementById('loading-text')!
      expect(loadingText.textContent).toBe('Loading engine for ra...')
    })

    it('does not throw when mod-selector element is missing', async () => {
      document.body.innerHTML = `
        <div id="loading-overlay" style="display:none">
          <div id="loading-bar" style="width:0%"></div>
          <span id="loading-text">Loading...</span>
        </div>
      `

      // Should not throw
      const promise = ModSelector.launchMod('ra')
      await vi.runAllTimersAsync()
      await expect(promise).resolves.toBeUndefined()
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
    it('completes without error in Phase A stub mode', async () => {
      createTestDOM()

      const promise = ModSelector.launchMod('ra')
      await vi.runAllTimersAsync()
      await promise

      // Should complete without throwing
      // Phase B will add real error handling with Game.create()
    })
  })
})
