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
// NOTE: Phase A 中 Game 类未实现，launchMod 显示加载状态后静默等待
router.on('/play/:modId', (params) => {
  ModSelector.launchMod(params['modId'])
})

// Editor placeholder — Phase D 中扩展
router.on('/editor/:modId', (params) => {
  const container = document.getElementById('mod-selector')!
  container.innerHTML = `
    <div style="text-align:center;padding:4rem">
      <h1 style="color:#eee;margin-bottom:1rem">Editor</h1>
      <p style="color:#aaa">Coming soon — ${params['modId']} map editor</p>
      <a href="/" style="color:#6688ee;margin-top:1rem;display:inline-block">Back to Mod Selector</a>
    </div>`
})

// 初始分发
router.dispatch()
