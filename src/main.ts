/**
 * main.ts — OpenRAWeb3D 应用入口
 * OpenRA 对照: OpenRA/OpenRA.Game/Program.cs（C# CLI 入口）
 *
 * 核心范式转换:
 * - C# Program.Main(args) CLI 入口 → 浏览器 URL 路由 SPA 入口
 * - C# Game.InitializeAndRun(args) 静态调用 → Router.dispatch() + ModSelector.show()
 *
 * Phase A: 建立路由基础设施，Mod 选择首页。
 * 游戏引擎（Babylon.js、Renderer 等）在此阶段不被加载。
 */

import './style.css'
import { Router } from './OpenRA.Game/Router.js'
import { ModSelector } from './OpenRA.Game/ModSelector.js'

// ---------------------------------------------------------------------------
// Application Entry
// ---------------------------------------------------------------------------

const router = new Router()

// 首页 → Mod 选择器
router.on('/', () => {
  const container = document.getElementById('mod-selector')
  if (container) {
    ModSelector.show(container)
  }
})

// 游戏启动 → Phase B 中实现
// NOTE: Phase B limitation — launchMod() loads the engine + mod shellmap
// but does NOT auto-start a game world. In Phase C, the main menu widget
// (rendered on uiScene) provides a "Skirmish" button that calls
// Game.startGame(map, WorldType.Regular) to transition from Shellmap to Playing.
router.on('/play/:modId', (params) => {
  ModSelector.launchMod(params['modId'])
})

// Editor placeholder — Phase D 中扩展
router.on('/editor/:modId', (params) => {
  const container = document.getElementById('mod-selector')!
  container.innerHTML = ''

  const wrapper = document.createElement('div')
  wrapper.style.textAlign = 'center'
  wrapper.style.padding = '4rem'

  const h1 = document.createElement('h1')
  h1.style.color = '#eee'
  h1.style.marginBottom = '1rem'
  h1.textContent = 'Editor'
  wrapper.appendChild(h1)

  const p = document.createElement('p')
  p.style.color = '#aaa'
  // 安全: 使用 textContent，不将用户控制的 URL 参数注入 innerHTML
  p.textContent = `Coming soon — ${params['modId']} map editor`
  wrapper.appendChild(p)

  const backLink = document.createElement('a')
  backLink.href = '/'
  backLink.style.color = '#6688ee'
  backLink.style.marginTop = '1rem'
  backLink.style.display = 'inline-block'
  backLink.textContent = 'Back to Mod Selector'
  backLink.addEventListener('click', (e) => {
    e.preventDefault()
    router.navigate('/')
  })
  wrapper.appendChild(backLink)

  container.appendChild(wrapper)
})

// 初始分发
router.dispatch()
