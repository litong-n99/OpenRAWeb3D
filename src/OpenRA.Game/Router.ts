/**
 * Router.ts — 客户端路径路由，支持模式匹配和浏览器历史记录
 * OpenRA 对照: 无直接 C# 对应（C# 使用 SDL2 窗口 + CLI 参数启动，Web 使用 URL 路由）
 *
 * 核心范式转换:
 * - C# Program.Main(args) CLI 入口 → 浏览器 URL 路由 (SPA + client-side Router)
 * - C# SDL2 事件循环 → window popstate 事件监听
 *
 * 零依赖: 不导入任何游戏引擎模块
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 路由处理器回调，接收从 URL 路径中提取的参数。
 *
 * 例如 URL `/play/ra` 匹配模式 `/play/:modId` 时，
 * handler 接收 `{ modId: 'ra' }`。
 */
export type RouteHandler = (params: Record<string, string>) => void

// ---------------------------------------------------------------------------
// Internal route storage
// ---------------------------------------------------------------------------

interface Route {
  /** 编译后的正则表达式，用于匹配 pathname */
  regex: RegExp
  /** 参数名数组，按捕获组顺序排列 */
  paramNames: string[]
  /** 匹配时调用的处理器 */
  handler: RouteHandler
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/** 客户端路径路由器。
 *
 * 将 URL 模式（如 `/play/:modId`）编译为正则表达式，
 * 匹配 `window.location.pathname` 并提取命名参数。
 *
 * OpenRA 对照: 无直接对应。C# OpenRA 通过 `Program.Main(args)` 获取 CLI 参数；
 * Web 版通过 URL 路由将 `/play/ra` 映射到 `Game.create(canvas, 'ra')`。
 */
export class Router {
  /** 已注册的路由列表，按注册顺序匹配（先注册先匹配） */
  private routes: Route[] = []

  /** popstate 事件侦听器的绑定引用，用于 cleanup */
  private _onPopState: () => void

  /** 构造路由器并绑定浏览器后退/前进事件。
   *
   * 自动监听 `window.addEventListener('popstate', ...)`。
   */
  constructor() {
    this._onPopState = () => this.dispatch()
    window.addEventListener('popstate', this._onPopState)
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** 注册一个路由模式和处理函数。
   *
   * 模式语法:
   * - 精确段: `/` 或 `/play`
   * - 参数段: `:paramName` → 匹配 `[^/]+` 并捕获为命名参数
   * - 允许多参数: `/edit/:modId/:mapId`
   *
   * @param pattern — 路由模式字符串（不含域名和查询参数）
   * @param handler — 匹配成功时调用的回调
   * @returns this（支持链式调用）
   */
  on(pattern: string, handler: RouteHandler): this {
    const paramNames: string[] = []

    // 将 ":paramName" 转为命名的捕获组
    // 按路径段分割处理，避免把捕获组 `([^/]+)` 中的正则字符也转义掉。
    const segments = pattern.split('/')
    const regexParts = segments.map(seg => {
      const paramMatch = seg.match(/^:([a-zA-Z][\w]*)$/)
      if (paramMatch) {
        paramNames.push(paramMatch[1])
        return '([^/]+)'
      }
      // 转义字面量段中的正则特殊字符
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    const regexStr = regexParts.join('/')

    const regex = new RegExp(`^${regexStr}$`)

    this.routes.push({ regex, paramNames, handler })
    return this
  }

  /** 使用当前 `window.location.pathname` 匹配已注册的路由。
   *
   * 按注册顺序匹配，首次匹配成功即停止。
   *
   * @returns `true` 如果找到匹配路由并调用了处理器，否则 `false`
   */
  dispatch(): boolean {
    const pathname = window.location.pathname

    for (const route of this.routes) {
      const match = pathname.match(route.regex)
      if (match) {
        // 第一个捕获组从 match[1] 开始
        const params: Record<string, string> = {}
        for (let i = 0; i < route.paramNames.length; i++) {
          params[route.paramNames[i]] = match[i + 1]
        }
        route.handler(params)
        return true
      }
    }

    return false
  }

  /** 导航到新路径并分发路由。
   *
   * 使用 `history.pushState()` 更新 URL 栏并添加到浏览器历史记录。
   * 然后调用 `dispatch()` 处理新路径。
   *
   * @param path — 目标路径（如 `/play/ra`）
   */
  navigate(path: string): void {
    window.history.pushState(null, '', path)
    this.dispatch()
  }

  /** 移除 popstate 事件侦听器。
   *
   * 在 Router 实例不再需要时调用，防止内存泄漏。
   */
  dispose(): void {
    window.removeEventListener('popstate', this._onPopState)
  }
}
