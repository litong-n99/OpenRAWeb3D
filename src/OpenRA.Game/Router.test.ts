/**
 * Router.test.ts — Router 迁移单元测试
 *
 * 测试客户端路径路由器的模式匹配、参数提取、浏览器历史记录和 popstate 事件。
 * 零依赖: 不导入 @babylonjs/core 或任何游戏引擎模块。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Router } from './Router'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 模拟 window.location.pathname */
function setPathname(path: string): void {
  Object.defineProperty(window, 'location', {
    value: {
      pathname: path,
    },
    writable: true,
    configurable: true,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Router', () => {
  let router: Router
  let handler: ReturnType<typeof vi.fn>
  let pushStateSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    router = new Router()
    handler = vi.fn()
    pushStateSpy = vi.fn()
    // 模拟 pushState 以便它实际更新 window.location.pathname，
    // 这样 navigate() → dispatch() 才能正确匹配目标路径。
    vi.spyOn(window.history, 'pushState').mockImplementation((_data, _title, url) => {
      pushStateSpy(_data, _title, url)
      if (typeof url === 'string') {
        setPathname(url)
      }
    })

    // 默认 pathname
    setPathname('/')
  })

  afterEach(() => {
    router.dispose()
    vi.restoreAllMocks()
  })

  // -----------------------------------------------------------------------
  // Pattern Registration
  // -----------------------------------------------------------------------

  describe('on() — pattern registration', () => {
    it('returns this for chaining', () => {
      const result = router.on('/', handler)
      expect(result).toBe(router)
    })

    it('registers an exact match pattern', () => {
      router.on('/', handler)
      router.dispatch()
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('registers a parameterized pattern', () => {
      setPathname('/play/ra')
      router.on('/play/:modId', handler)
      router.dispatch()
      expect(handler).toHaveBeenCalledWith({ modId: 'ra' })
    })

    it('registers a multi-parameter pattern', () => {
      setPathname('/edit/ra/mymap')
      router.on('/edit/:modId/:mapId', handler)
      router.dispatch()
      expect(handler).toHaveBeenCalledWith({ modId: 'ra', mapId: 'mymap' })
    })
  })

  // -----------------------------------------------------------------------
  // dispatch()
  // -----------------------------------------------------------------------

  describe('dispatch() — pathname matching', () => {
    it('matches exact path "/"', () => {
      setPathname('/')
      router.on('/', handler)
      const result = router.dispatch()
      expect(result).toBe(true)
      expect(handler).toHaveBeenCalledWith({})
    })

    it('matches exact path "/play"', () => {
      setPathname('/play')
      router.on('/play', handler)
      const result = router.dispatch()
      expect(result).toBe(true)
    })

    it('matches parameterized path "/play/ra"', () => {
      setPathname('/play/ra')
      router.on('/play/:modId', handler)
      const result = router.dispatch()
      expect(result).toBe(true)
      expect(handler).toHaveBeenCalledWith({ modId: 'ra' })
    })

    it('matches multi-parameter path "/edit/ra/map1"', () => {
      setPathname('/edit/ra/map1')
      router.on('/edit/:modId/:mapId', handler)
      const result = router.dispatch()
      expect(result).toBe(true)
      expect(handler).toHaveBeenCalledWith({ modId: 'ra', mapId: 'map1' })
    })

    it('matches first registered route when multiple match', () => {
      setPathname('/play/ra')
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      router.on('/play/:modId', handler1)
      router.on('/play/ra', handler2)
      router.dispatch()
      expect(handler1).toHaveBeenCalledTimes(1)
      expect(handler2).not.toHaveBeenCalled()
    })

    it('returns false for unknown path', () => {
      setPathname('/unknown')
      router.on('/', handler)
      const result = router.dispatch()
      expect(result).toBe(false)
      expect(handler).not.toHaveBeenCalled()
    })

    it('does not match partial segments', () => {
      setPathname('/play')
      router.on('/play/ra', handler)
      const result = router.dispatch()
      expect(result).toBe(false)
    })

    it('handles empty params object for exact match', () => {
      setPathname('/')
      router.on('/', handler)
      router.dispatch()
      expect(handler).toHaveBeenCalledWith({})
    })

    it('extracts param with hyphens and underscores', () => {
      setPathname('/play/ra-test_v2')
      router.on('/play/:modId', handler)
      router.dispatch()
      expect(handler).toHaveBeenCalledWith({ modId: 'ra-test_v2' })
    })

    it('extracts multiple params from deep path', () => {
      setPathname('/edit/td/skirmish/map_001')
      router.on('/edit/:modId/:gameType/:mapId', handler)
      router.dispatch()
      expect(handler).toHaveBeenCalledWith({ modId: 'td', gameType: 'skirmish', mapId: 'map_001' })
    })
  })

  // -----------------------------------------------------------------------
  // navigate()
  // -----------------------------------------------------------------------

  describe('navigate() — history push + dispatch', () => {
    it('calls history.pushState with the given path', () => {
      router.on('/play/:modId', handler)
      router.navigate('/play/ra')
      expect(pushStateSpy).toHaveBeenCalledWith(null, '', '/play/ra')
    })

    it('triggers handler for the navigated path', () => {
      router.on('/play/:modId', handler)
      router.navigate('/play/ra')
      expect(handler).toHaveBeenCalledWith({ modId: 'ra' })
    })

    it('does not trigger handler if no route matches', () => {
      router.on('/', handler)
      router.navigate('/unknown')
      expect(handler).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // popstate event
  // -----------------------------------------------------------------------

  describe('popstate event', () => {
    it('dispatches on popstate event', () => {
      setPathname('/play/ra')
      router.on('/play/:modId', handler)

      // 重置 handler 计数（构造时不触发）
      handler.mockReset()

      window.dispatchEvent(new PopStateEvent('popstate'))
      expect(handler).toHaveBeenCalledWith({ modId: 'ra' })
    })

    it('does not call handler if popstate fires but no route matches', () => {
      setPathname('/unknown')
      router.on('/play/:modId', handler)
      handler.mockReset()

      window.dispatchEvent(new PopStateEvent('popstate'))
      expect(handler).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // dispose()
  // -----------------------------------------------------------------------

  describe('dispose()', () => {
    it('removes popstate listener', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener')
      router.dispose()
      expect(removeSpy).toHaveBeenCalledWith('popstate', expect.any(Function))
    })

    it('does not dispatch after dispose on popstate', () => {
      setPathname('/play/ra')
      router.on('/play/:modId', handler)
      router.dispose()
      handler.mockReset()

      window.dispatchEvent(new PopStateEvent('popstate'))
      // After dispose, popstate listener should be removed
      // handler should NOT be called
      expect(handler).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // Chaining
  // -----------------------------------------------------------------------

  describe('chaining', () => {
    it('supports fluent API with multiple routes', () => {
      const homeHandler = vi.fn()
      const playHandler = vi.fn()

      router
        .on('/', homeHandler)
        .on('/play/:modId', playHandler)

      setPathname('/')
      router.dispatch()
      expect(homeHandler).toHaveBeenCalledTimes(1)
      expect(playHandler).not.toHaveBeenCalled()

      homeHandler.mockReset()
      setPathname('/play/ra')
      router.dispatch()
      expect(homeHandler).not.toHaveBeenCalled()
      expect(playHandler).toHaveBeenCalledWith({ modId: 'ra' })
    })
  })
})
