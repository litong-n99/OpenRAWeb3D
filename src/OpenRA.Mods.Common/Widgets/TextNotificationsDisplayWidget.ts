/**
 * TextNotificationsDisplayWidget.ts — 游戏事件文本通知滚动显示 widget
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/TextNotificationsDisplayWidget.cs (138 lines)
 *
 * 核心范式转换:
 * - OpenRA WidgetUtils.SetupTextNotification + template cloning
 *   → DOM div 元素 + CSS 类名（基于通知池）
 * - OpenRA Game.Renderer.EnableScissor() (OpenGL 裁剪)
 *   → CSS overflow: hidden 容器裁剪
 * - OpenRA Game.RunTime + expirations 列表 (tick 驱动过期)
 *   → setTimeout / setInterval + Date.now()
 * - OpenRA 子 widget 位置动画 (Bounds.Y 调整)
 *   → CSS transition: transform 实现平滑移动
 * - OpenRA Children 管理 → DOM 子元素管理
 */

import { Widget } from '../../OpenRA.Game/Widgets/Widget.js'
import type {
  WidgetArgs,
  WidgetEvent,
} from '../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// TextNotification — 单条通知数据
// OpenRA 对照: TextNotification struct (在 TextNotificationsDisplayWidget 中使用)
// ---------------------------------------------------------------------------

/** 通知池类型（消息类别）。OpenRA 对照: TextNotificationPool */
export const TextNotificationPool = {
  Chat: 'chat' as const,
  System: 'system' as const,
  Mission: 'mission' as const,
  Feedback: 'feedback' as const,
  Transients: 'transients' as const,
}
export type TextNotificationPool =
  (typeof TextNotificationPool)[keyof typeof TextNotificationPool]

/** 单条文本通知数据。OpenRA 对照: TextNotification */
export interface TextNotification {
  /** 通知文本内容 */
  text: string
  /** 通知池（消息类别） */
  pool: TextNotificationPool
  /** 添加时间戳 (ms, Date.now()) */
  timestamp?: number
}

// ---------------------------------------------------------------------------
// NotificationEntry — 内部通知条目
// ---------------------------------------------------------------------------

/** 内部通知条目，包含 DOM 元素、过期时间和数据。 */
interface NotificationEntry {
  /** 通知数据 */
  data: TextNotification
  /** DOM 元素 */
  element: HTMLElement
  /** 过期时间戳 (ms) */
  expiresAt: number
}

// ---------------------------------------------------------------------------
// TextNotificationsDisplayWidget — 滚动通知显示
// OpenRA 对照: public class TextNotificationsDisplayWidget : Widget
// ---------------------------------------------------------------------------

/**
 * 游戏事件文本通知滚动显示 widget。
 *
 * 从底部滚动显示最近的游戏事件通知文本。
 * 每条通知带有淡入淡出动画和自动过期移除。
 * 支持分类池（聊天、系统、任务、反馈、瞬时消息）。
 *
 * OpenRA 对照: public class TextNotificationsDisplayWidget : Widget
 */
export class TextNotificationsDisplayWidget extends Widget {
  // ---- 配置属性 (OpenRA 对照: 同名字段) ----

  /** 自动移除前的显示时长（毫秒），0 表示不自动移除。
   * OpenRA 对照: DisplayDurationMs */
  displayDurationMs: number = 0

  /** 通知项之间的间距（像素）。OpenRA 对照: ItemSpacing */
  itemSpacing: number = 4

  /** 底边距（像素）。OpenRA 对照: BottomSpacing */
  bottomSpacing: number = 0

  /** 最大可见通知数（超出后移除最早的）。
   * OpenRA 对照: LogLength */
  logLength: number = 8

  /** 是否隐藏溢出内容（裁剪到 Bounds）。
   * OpenRA 对照: HideOverflow */
  hideOverflow: boolean = true

  // ---- 内部状态 ----

  /** 通知条目列表（按添加顺序排列，最早的在前面）。
   * OpenRA 对照: Children + expirations */
  private _entries: NotificationEntry[] = []

  /** 过期检查定时器 ID */
  private _expiryTimer: ReturnType<typeof setInterval> | null = null

  /** 通知容器 DOM 元素 */
  private _containerEl: HTMLElement | null = null

  /** 是否已开始 tick（用于启动过期定时器） */
  private _started: boolean = false

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: 默认构造函数
  // ---------------------------------------------------------------------------

  constructor() {
    super()
  }

  // ---------------------------------------------------------------------------
  // Initialize
  // OpenRA 对照: public override void Initialize(WidgetArgs args)
  // ---------------------------------------------------------------------------

  /**
   * 初始化 widget。设置 EventBounds 为空矩形（通知不消费鼠标事件）。
   *
   * OpenRA 对照: public override void Initialize(WidgetArgs args)
   */
  override initialize(args: WidgetArgs): void {
    super.initialize(args)
  }

  // ---------------------------------------------------------------------------
  // AddNotification — 添加通知
  // OpenRA 对照: public void AddNotification(TextNotification notification)
  // ---------------------------------------------------------------------------

  /**
   * 添加一条文本通知。
   *
   * 通知从底部滚入，已有通知向上移动。当通知数超过 logLength
   * 时，移除最早的通知。若 displayDurationMs > 0，到期后自动移除。
   *
   * OpenRA 对照: public void AddNotification(TextNotification notification)
   *
   * @param notification — 通知数据（文本 + 池类型）
   */
  addNotification(notification: TextNotification): void {
    const now = Date.now()
    const entry: NotificationEntry = {
      data: { ...notification, timestamp: now },
      element: this._createNotificationElement(notification),
      expiresAt: this.displayDurationMs > 0
        ? now + this.displayDurationMs
        : Number.MAX_SAFE_INTEGER,
    }

    // 插入到列表末尾（最新在最后）
    this._entries.push(entry)

    // 挂载到 DOM 容器
    if (this._containerEl) {
      this._containerEl.appendChild(entry.element)
    }

    // 触发淡入动画
    requestAnimationFrame(() => {
      entry.element.style.opacity = '1'
    })

    // 移除超出限制的通知
    while (this._entries.length > this.logLength) {
      this._removeOldestNotification()
    }

    // 更新滚动位置以显示最新通知
    this._scrollToLatest()
  }

  // ---------------------------------------------------------------------------
  // RemoveMostRecentNotification — 移除最新通知
  // OpenRA 对照: public void RemoveMostRecentNotification()
  // ---------------------------------------------------------------------------

  /**
   * 移除最新的一条通知。
   *
   * OpenRA 对照: public void RemoveMostRecentNotification()
   */
  removeMostRecentNotification(): void {
    if (this._entries.length === 0) return

    const entry = this._entries.pop()!
    this._fadeOutAndRemove(entry)
  }

  // ---------------------------------------------------------------------------
  // RemoveNotification (private) — 移除最早的通知
  // OpenRA 对照: void RemoveNotification()
  // ---------------------------------------------------------------------------

  /**
   * 移除最早的一条通知。
   *
   * OpenRA 对照: void RemoveNotification()
   */
  private _removeOldestNotification(): void {
    if (this._entries.length === 0) return

    const entry = this._entries.shift()!
    this._fadeOutAndRemove(entry)
  }

  // ---------------------------------------------------------------------------
  // Per-frame tick — 检查过期通知
  // OpenRA 对照: public override void Tick()
  // ---------------------------------------------------------------------------

  /**
   * 每帧 tick — 检查并移除过期的通知。
   *
   * OpenRA 对照: public override void Tick()
   */
  override tick(): void {
    super.tick()

    // 启动过期定时器（首次 tick 时）
    if (!this._started && this.displayDurationMs > 0) {
      this._started = true
      this._startExpiryTimer()
    }

    // 过期检查（同步，由 tick 驱动）
    if (this.displayDurationMs > 0 && this._entries.length > 0) {
      const now = Date.now()
      // 最早的通知在最前面，expirations 列表按到期时间升序排列
      while (
        this._entries.length > 0 &&
        now >= this._entries[0].expiresAt
      ) {
        this._removeOldestNotification()
      }
    }
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // OpenRA 对照: DrawOuter() → 渲染子 widget（DrawOuter 从最近开始迭代）
  // ---------------------------------------------------------------------------

  /**
   * 渲染通知列表为 DOM 元素。
   *
   * 返回一个具有 overflow: hidden 裁剪容器的 `<div>`，
   * 通知按垂直列表排列，从底部向上堆叠。
   *
   * OpenRA 对照: public override void DrawOuter()
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'text-notifications-display-widget')
    el.style.position = 'absolute'
    el.style.overflow = this.hideOverflow ? 'hidden' : 'visible'
    el.style.userSelect = 'none'
    el.style.boxSizing = 'border-box'
    el.style.pointerEvents = 'none' // 通知不拦截鼠标事件

    if (this.id) {
      el.setAttribute('data-widget-id', this.id)
    }

    // 创建或复用通知容器
    if (!this._containerEl) {
      this._containerEl = document.createElement('div')
      this._containerEl.className = 'notification-list'
      this._containerEl.style.position = 'absolute'
      this._containerEl.style.left = '0'
      this._containerEl.style.right = '0'
      this._containerEl.style.bottom = `${this.bottomSpacing}px`
      this._containerEl.style.display = 'flex'
      this._containerEl.style.flexDirection = 'column-reverse' // 底部对齐
      this._containerEl.style.gap = `${this.itemSpacing}px`
      this._containerEl.style.maxHeight = '100%'
    }

    // 同步容器到 DOM
    if (this._containerEl.parentElement !== el) {
      el.appendChild(this._containerEl)
    }

    // 重新挂载所有活跃入口
    this._syncEntriesToContainer()

    return el
  }

  // ---------------------------------------------------------------------------
  // 事件处理 (不处理鼠标事件)
  // OpenRA 对照: EventBounds => Rectangle.Empty
  // ---------------------------------------------------------------------------

  /**
   * 通知列表不处理鼠标事件。
   *
   * OpenRA 对照: public override Rectangle EventBounds => Rectangle.Empty
   */
  override handleEvent(_event: WidgetEvent): boolean {
    return false
  }

  /** 不改变光标。 */
  override getCursor(_pos: { x: number; y: number }): string | null {
    return null
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  /**
   * 释放 widget 资源 — 停止过期定时器，清理 DOM 元素。
   */
  override dispose(): void {
    this._stopExpiryTimer()
    for (const entry of this._entries) {
      if (entry.element.parentNode) {
        entry.element.parentNode.removeChild(entry.element)
      }
    }
    this._entries = []
    this._containerEl = null
    super.dispose()
  }

  // ===================================================================
  // Private helpers
  // ===================================================================

  /**
   * 为通知创建 DOM 元素（带淡入效果）。
   */
  private _createNotificationElement(notification: TextNotification): HTMLElement {
    const el = document.createElement('div')
    el.className = `notification-item notification-pool-${notification.pool}`
    el.textContent = notification.text
    el.style.opacity = '0'
    el.style.transition = 'opacity 0.3s ease-in-out'
    el.style.fontFamily = 'Arial, sans-serif'
    el.style.fontSize = '14px'
    el.style.padding = '2px 4px'
    el.style.whiteSpace = 'nowrap'
    el.style.overflow = 'hidden'
    el.style.textOverflow = 'ellipsis'
    el.style.pointerEvents = 'none'
    el.setAttribute('data-pool', notification.pool)
    return el
  }

  /**
   * 淡出并移除通知条目。
   */
  private _fadeOutAndRemove(entry: NotificationEntry): void {
    // 淡出动画
    entry.element.style.opacity = '0'
    entry.element.style.transition = 'opacity 0.5s ease-out'

    // 动画结束后移除 DOM 元素
    const onTransitionEnd = () => {
      entry.element.removeEventListener('transitionend', onTransitionEnd)
      if (entry.element.parentNode) {
        entry.element.parentNode.removeChild(entry.element)
      }
    }
    entry.element.addEventListener('transitionend', onTransitionEnd)

    // 备用：若过渡事件未触发，500ms 后强制移除
    setTimeout(() => {
      if (entry.element.parentNode) {
        entry.element.parentNode.removeChild(entry.element)
      }
    }, 600)
  }

  /**
   * 滚动到最新通知。
   */
  private _scrollToLatest(): void {
    if (!this._containerEl) return
    // 使用 scrollIntoView 或者简单设置 scrollTop
    // 由于使用 column-reverse 从底部显示，不需要额外滚动
    this._containerEl.scrollTop = this._containerEl.scrollHeight
  }

  /**
   * 将内部条目同步到 DOM 容器。
   */
  private _syncEntriesToContainer(): void {
    if (!this._containerEl) return

    // 清除容器中非入口的元素
    while (this._containerEl.firstChild) {
      this._containerEl.removeChild(this._containerEl.firstChild)
    }

    // 反向添加（最新的在底部，column-reverse 让它显示在底部）
    for (const entry of this._entries) {
      this._containerEl.appendChild(entry.element)
    }
  }

  /**
   * 启动过期检查定时器。
   */
  private _startExpiryTimer(): void {
    if (this._expiryTimer) return
    // 每 500ms 检查一次过期（避免每帧检查）
    this._expiryTimer = setInterval(() => {
      if (this._entries.length === 0) return
      const now = Date.now()
      while (
        this._entries.length > 0 &&
        now >= this._entries[0].expiresAt
      ) {
        this._removeOldestNotification()
      }
    }, 500)
  }

  /**
   * 停止过期检查定时器。
   */
  private _stopExpiryTimer(): void {
    if (this._expiryTimer) {
      clearInterval(this._expiryTimer)
      this._expiryTimer = null
    }
  }
}
