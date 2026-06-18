/**
 * ModSelector.ts — Mod 选择首页，轻量 DOM 渲染（不加载游戏引擎）
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/ModBrowserWidget.cs（C# 使用游戏内 Widget）
 *
 * 核心范式转换:
 * - C# 游戏内 ModBrowserWidget（需完整引擎加载） → 独立 DOM Mod 选择器（< 10 KB JS）
 * - C# mix 包资源 → 静态 JSON 清单（public/mods/_index.json）
 * - 游戏引擎延迟加载: 仅在用户选择 Mod 后才动态 import('../OpenRA.Game/Game.js')
 *
 * 零依赖: 不导入 @babylonjs/core 或任何游戏引擎模块
 */

import { WorldType as _WorldType } from './World.js'
import type { WorldType as _WorldTypeType } from './World.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Mod 条目信息，对应 public/mods/_index.json 中每个 mod 的结构 */
export interface ModEntry {
  id: string
  title: string
  version: string
  description: string
  factions: string[]
  thumbnail: string
  background: string
  available: boolean
}

// Re-export WorldType for downstream consumers (main.ts, ModSelector consumers)
// NOTE: Previously defined locally; now imports from World.ts to maintain
// a single canonical definition (MINOR-1 fix).
export const WorldType = _WorldType
export type WorldType = _WorldTypeType

// ---------------------------------------------------------------------------
// ModSelector
// ---------------------------------------------------------------------------

/** Mod 选择首页。
 *
 * 获取 `public/mods/_index.json`，渲染 Mod 卡片网格，处理点击启动 Mod。
 * 完全不依赖游戏引擎 — 整个 Mod 选择器在 ~10 KB JS 内完成。
 *
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/ModBrowserWidget.cs
 * C# 版本作为游戏内 Widget 运行；Web 版作为独立 DOM 页面运行。
 */
export class ModSelector {
  // -----------------------------------------------------------------------
  // Static helpers
  // -----------------------------------------------------------------------

  /** 获取已安装 Mod 的清单。
   *
   * @returns Mod 条目数组
   */
  private static async fetchModIndex(): Promise<ModEntry[]> {
    const response = await fetch('/mods/_index.json')
    if (!response.ok) {
      throw new Error(`Failed to fetch mod index: ${response.status}`)
    }
    const data = await response.json() as { mods: ModEntry[] }
    return data.mods || []
  }

  // -----------------------------------------------------------------------
  // Card Rendering
  // -----------------------------------------------------------------------

  /** 为单个 Mod 条目创建 DOM 卡片元素。 */
  private static createModCard(mod: ModEntry): HTMLElement {
    const card = document.createElement('div')
    card.className = `mod-card${mod.available ? '' : ' unavailable'}`
    card.setAttribute('data-mod-id', mod.id)

    // "Coming Soon" 丝带（unavailable mod 专用）
    if (!mod.available) {
      const ribbon = document.createElement('div')
      ribbon.className = 'mod-card-ribbon'
      ribbon.textContent = 'Coming Soon'
      card.appendChild(ribbon)
    }

    // 标题
    const title = document.createElement('h2')
    title.className = 'mod-card-title'
    title.textContent = mod.title
    card.appendChild(title)

    // 版本
    const version = document.createElement('span')
    version.className = 'mod-card-version'
    version.textContent = mod.version
    card.appendChild(version)

    // 描述
    const desc = document.createElement('p')
    desc.className = 'mod-card-description'
    desc.textContent = mod.description
    card.appendChild(desc)

    // 阵营标签
    if (mod.factions.length > 0) {
      const tags = document.createElement('div')
      tags.className = 'mod-card-factions'
      for (const faction of mod.factions) {
        const tag = document.createElement('span')
        tag.className = 'mod-card-faction-tag'
        tag.textContent = faction
        tags.appendChild(tag)
      }
      card.appendChild(tags)
    }

    // 播放按钮（仅可用 Mod）
    if (mod.available) {
      const btn = document.createElement('button')
      btn.className = 'mod-card-play-btn'
      btn.textContent = 'Play →'
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        ModSelector.launchMod(mod.id)
      })
      card.appendChild(btn)
    }

    return card
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** 渲染 Mod 选择页面到指定的容器元素。
   *
   * 获取 `_index.json`，为每个 Mod 创建卡片，注册点击处理器。
   * 如果获取失败或列表为空，显示适当的回退 UI。
   *
   * @param container — 渲染 Mod 卡片的 DOM 容器
   */
  static async show(container: HTMLElement): Promise<void> {
    // 清理容器
    container.innerHTML = ''

    try {
      const mods = await ModSelector.fetchModIndex()

      if (mods.length === 0) {
        container.innerHTML = `
          <div class="mod-selector-empty">
            <h1>No Mods Available</h1>
            <p>No mod content found. Place mod manifests in <code>public/mods/</code>.</p>
          </div>`
        return
      }

      // 创建头部
      const header = document.createElement('div')
      header.className = 'mod-selector-header'
      header.innerHTML = '<h1>OpenRAWeb3D</h1><p>Select a mod to launch</p>'
      container.appendChild(header)

      // 创建卡片网格
      const grid = document.createElement('div')
      grid.className = 'mod-card-grid'
      for (const mod of mods) {
        grid.appendChild(ModSelector.createModCard(mod))
      }
      container.appendChild(grid)
    } catch (err) {
      container.innerHTML = `
        <div class="mod-selector-error">
          <h1>Failed to Load Mods</h1>
          <p>${err instanceof Error ? err.message : 'Unknown error'}</p>
        </div>`
    }
  }

  /** 启动指定 Mod。
   *
   * 隐藏 Mod 选择器，显示加载遮罩。在 Phase A 中，
   * 动态 `import()` 是 stub — Game 类将在 Phase B 中实现。
   * 当前实现显示加载状态并等待（为 Phase B 准备好调用链）。
   *
   * OpenRA 对照: C# 中用户点击 mod 项后调用 `Game.InitializeAndRun(args)`
   *
   * @param modId — 要启动的 Mod ID（如 "ra", "td"）
   * @param worldType — 世界类型（Regular/Shellmap/Editor），默认 Regular
* Pass worldType to Game.create()
   */
  static async launchMod(modId: string, worldType: WorldType = WorldType.Regular): Promise<void> {
    // 隐藏 Mod 选择器
    const modSelector = document.getElementById('mod-selector')
    if (modSelector) {
      modSelector.style.display = 'none'
    }

    // 显示加载遮罩
    const overlay = document.getElementById('loading-overlay')
    const loadingText = document.getElementById('loading-text')
    const loadingBar = document.getElementById('loading-bar')

    if (overlay) {
      overlay.style.display = 'flex'
    }

    const setProgress = (text: string, pct: number) => {
      if (loadingText) loadingText.textContent = text
      if (loadingBar) loadingBar.style.width = `${pct}%`
    }

    // Phase B: 动态导入 Game 类并调用 Game.create()
    // 使用动态 import() 确保游戏引擎（包括 Babylon.js）延迟加载
    try {
      // 准备 canvas
      const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null
      if (!canvas) {
        throw new Error('Canvas element #game-canvas not found in DOM')
      }
      canvas.style.display = 'block'

      setProgress('Loading engine...', 15)

      const { Game } = await import('./Game.js')

      setProgress(`Loading mod '${modId}'...`, 30)

      await Game.create(canvas, modId, worldType)

      setProgress('Ready', 100)

      // 短暂显示完成状态后隐藏加载遮罩
      await new Promise(resolve => setTimeout(resolve, 300))
      if (overlay) {
        overlay.style.display = 'none'
      }
    } catch (err) {
      setProgress(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`, 0)
      console.error(`[ModSelector] Failed to launch mod '${modId}':`, err)
      // 显示错误 ~3 秒后返回 Mod 选择器，防止用户卡在加载遮罩
      await new Promise(resolve => setTimeout(resolve, 3000))
      ModSelector.hide()
    }
  }

  /** 隐藏 Mod 选择器并清理 DOM。
   *
   * 从容器中移除所有子元素，隐藏加载遮罩。
   */
  static hide(): void {
    const modSelector = document.getElementById('mod-selector')
    if (modSelector) {
      modSelector.innerHTML = ''
      modSelector.style.display = ''
    }

    const overlay = document.getElementById('loading-overlay')
    if (overlay) {
      overlay.style.display = 'none'
    }

    const loadingBar = document.getElementById('loading-bar')
    if (loadingBar) {
      loadingBar.style.width = '0%'
    }

    const loadingText = document.getElementById('loading-text')
    if (loadingText) {
      loadingText.textContent = 'Loading...'
    }
  }
}
