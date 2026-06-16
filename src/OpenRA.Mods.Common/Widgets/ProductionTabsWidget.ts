/**
 * ProductionTabsWidget.ts — 生产分组标签栏 widget：横向标签切换生产队列分类
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/ProductionTabsWidget.cs (370 lines)
 *
 * 核心范式转换:
 * - C# SpriteFont.DrawTextWithContrast bitmap 文本 → CSS font-family + text-shadow (DOM 渲染)
 * - C# Game.Renderer.EnableScissor(Rectangle) 裁剪 → CSS overflow: hidden
 * - C# WidgetUtils.DrawPanel 9-slice 面板 → CSS background-color (stub)
 * - C# ButtonWidget.DrawBackground 状态感知背景 → CSS data-state 属性
 * - C# CachedTransform<(bool,bool,bool,bool,bool), Sprite> → CSS 类切换
 * - C# Game.Sound.PlayNotification → 静态可替换 SoundCallback
 * - C# ChromeLogic / ActorChanged 生产队列追踪 → 直接订阅 + 队列变更回调
 *
 * ProductionTabsWidget 显示一个可滚动的横向标签栏，每个标签代表一个
 * 生产队列组（如 Building, Infantry, Vehicle）。当前选中的标签高亮显示，
 * 已完成生产的标签以金色显示。箭头按钮支持滚动。
 */

import { Widget, boundsContains, boundsLeft, boundsTop, boundsRight } from '../../OpenRA.Game/Widgets/Widget.js'
import type { WidgetArgs, WidgetEvent, WidgetBounds } from '../../OpenRA.Game/Widgets/Widget.js'
import { HotkeyReference } from '../../OpenRA.Game/Input/HotkeyReference.js'
import { Modifiers } from '../../OpenRA.Game/Input/IInputHandler.js'

// ---------------------------------------------------------------------------
// Stub types (ProductionQueue interface for type info)
// ---------------------------------------------------------------------------

import type { ProductionQueue } from '../Traits/Player/ProductionQueue.js'

// ---------------------------------------------------------------------------
// ProductionTab — data container for a single tab
// OpenRA 对照: ProductionTab
// ---------------------------------------------------------------------------

/**
 * Represents a single production tab.
 *
 * OpenRA 对照: ProductionTab
 */
export interface ProductionTab {
  /** Tab display name (queue number). */
  name: string
  /** The production queue this tab represents. */
  queue: ProductionQueue
}

// ---------------------------------------------------------------------------
// ProductionTabGroup — manages tabs for a single production group
// OpenRA 对照: ProductionTabGroup
// ---------------------------------------------------------------------------

/**
 * Manages a group of production tabs (for one production category).
 *
 * Tracks which queues are active and whether any have completed items (alert state).
 *
 * OpenRA 对照: ProductionTabGroup
 */
export class ProductionTabGroup {
  /** Tab list. */
  tabs: ProductionTab[] = []

  /** The group name (e.g., "Building", "Infantry"). */
  group: string

  /** Next queue name number to assign. */
  nextQueueName: number = 1

  constructor(group: string) {
    this.group = group
  }

  /** Check if any tab in this group has completed items (for alert highlight).
   *
   * OpenRA 对照: ProductionTabGroup.Alert
   */
  get alert(): boolean {
    for (const t of this.tabs) {
      const allQ = t.queue.allQueued()
      for (const i of allQ) {
        if (i.done) return true
      }
    }
    return false
  }

  /** Update the tab list from the current set of production queues.
   *
   * Removes stale tabs and adds new queues, assigning sequential names.
   *
   * OpenRA 对照: ProductionTabGroup.Update(IEnumerable<ProductionQueue>)
   */
  update(allQueues: ProductionQueue[]): void {
    const queues = allQueues.filter(
      (q) => q.enabled && q.info.group === this.group,
    )
    const newTabs: ProductionTab[] = []
    let largestUsedName = 0

    // Keep existing tabs that still have their queue
    for (const t of this.tabs) {
      const stillExists = queues.includes(t.queue)
      if (!stillExists) continue

      newTabs.push(t)
      const idx = queues.indexOf(t.queue)
      if (idx >= 0) queues.splice(idx, 1)
      const nameNum = parseInt(t.name, 10)
      if (!isNaN(nameNum) && nameNum > largestUsedName) {
        largestUsedName = nameNum
      }
    }

    this.nextQueueName = largestUsedName + 1

    // Add new queues
    for (const queue of queues) {
      newTabs.push({
        name: String(this.nextQueueName++),
        queue,
      })
    }

    this.tabs = newTabs
  }
}

// ---------------------------------------------------------------------------
// ProductionTabsWidget — 生产标签栏 widget
// OpenRA 对照: ProductionTabsWidget : Widget
// ---------------------------------------------------------------------------

/**
 * Horizontal tab bar widget for switching between production queues.
 *
 * Each tab represents a production queue within the current group.
 * The bar supports left/right arrow scrolling when tabs overflow.
 * Completed production items cause the tab to show in gold color.
 *
 * OpenRA 对照: public class ProductionTabsWidget : Widget
 */
export class ProductionTabsWidget extends Widget {
  // ---- Static sound callback ----

  /** Sound player callback.
   *
   * OpenRA 对照: Game.Sound.PlayNotification(ModRules, null, "Sounds", name, null)
   */
  static soundPlayer: ((soundName: string) => void) | null = null

  // ---- Configuration ----

  /** Palette widget ID to connect to. */
  paletteWidgetId: string | null = null

  /** Types container ID. */
  typesContainerId: string | null = null

  /** Background container ID. */
  backgroundContainerId: string | null = null

  /** Width of each tab in pixels. */
  tabWidth: number = 30

  /** Width of arrow buttons in pixels. */
  arrowWidth: number = 20

  /** Sound played on successful click. */
  clickSound: string = 'ClickSound'

  /** Sound played when click is rejected. */
  clickDisabledSound: string = 'ClickDisabledSound'

  /** Hotkey for previous tab. */
  previousProductionTabKey: HotkeyReference = new HotkeyReference(
    // Default: no hotkey
  )

  /** Hotkey for next tab. */
  nextProductionTabKey: HotkeyReference = new HotkeyReference(
    // Default: no hotkey
  )

  /** Production tab groups (keyed by group name). */
  groups: Map<string, ProductionTabGroup> = new Map()

  /** Arrow button chrome name. */
  arrowButton: string = 'button'

  /** Tab button chrome name. */
  tabButton: string = 'button'

  /** Background chrome collection. */
  background: string = 'panel-black'

  /** Decorations collection for scroll arrows. */
  decorations: string = 'scrollpanel-decorations'
  decorationScrollLeft: string = 'left'
  decorationScrollRight: string = 'right'

  /** Tab text color. */
  tabColor: string = '#FFFFFF'

  /** Tab text color when items are done. */
  tabColorDone: string = '#FFD700'

  /** Font for tab text. */
  tabFont: string = '11px monospace'

  // ---- State ----

  /** Current scroll offset. */
  private _listOffset: number = 0

  /** Total content width. */
  private _contentWidth: number = 0

  /** Whether left arrow is pressed. */
  private _leftPressed: boolean = false

  /** Whether right arrow is pressed. */
  private _rightPressed: boolean = false

  /** Left arrow button bounds. */
  private _leftButtonRect: WidgetBounds = { x: 0, y: 0, width: 0, height: 0 }

  /** Right arrow button bounds. */
  private _rightButtonRect: WidgetBounds = { x: 0, y: 0, width: 0, height: 0 }

  /** Current queue group. */
  private _queueGroup: string | null = null

  /** Current selected queue. */
  private _currentQueue: ProductionQueue | null = null

  /** Cached queue enabled states for change detection. */
  private _cachedQueueEnabledStates: { queue: ProductionQueue; enabled: boolean }[] = []

  /** Reference to the connected ProductionPaletteWidget. */
  private _paletteWidget: unknown = null

  /** Resolver for the palette widget (lazy). */
  private _paletteWidgetResolver: (() => unknown) | null = null

  /** Whether the palette widget has been resolved. */
  private _paletteWidgetResolved: boolean = false

  constructor(groups: Map<string, ProductionTabGroup> = new Map()) {
    super()
    this.groups = groups
    this.isVisible = () =>
      !!this._queueGroup && (this.groups.get(this._queueGroup)?.tabs.length ?? 0) > 0
  }

  // ---------------------------------------------------------------------------
  // Initialize — compute button rects
  // OpenRA 对照: Initialize(WidgetArgs)
  // ---------------------------------------------------------------------------

  /** Initialize bounds and button rectangles.
   *
   * OpenRA 对照: override void Initialize(WidgetArgs args)
   */
  override initialize(args: WidgetArgs): void {
    super.initialize(args)

    const rb = this.bounds
    this._leftButtonRect = {
      x: boundsLeft(rb),
      y: boundsTop(rb),
      width: this.arrowWidth,
      height: rb.height,
    }
    this._rightButtonRect = {
      x: boundsRight(rb) - this.arrowWidth,
      y: boundsTop(rb),
      width: this.arrowWidth,
      height: rb.height,
    }
  }

  // ---------------------------------------------------------------------------
  // Queue group & current queue accessors
  // OpenRA 对照: QueueGroup / CurrentQueue
  // ---------------------------------------------------------------------------

  /** Get the current queue group. */
  get queueGroup(): string | null {
    return this._queueGroup
  }

  /** Set the queue group.
   *
   * Resets scroll and selects the first tab.
   *
   * OpenRA 对照: QueueGroup setter
   */
  set queueGroup(value: string | null) {
    this._listOffset = 0
    this._queueGroup = value
    this.selectNextTab(false)
  }

  /** Get the current production queue. */
  get currentQueue(): ProductionQueue | null {
    return this._getPaletteCurrentQueue()
  }

  /** Set the current production queue.
   *
   * OpenRA 对照: CurrentQueue setter
   */
  set currentQueue(value: ProductionQueue | null) {
    this._setPaletteCurrentQueue(value)
    if (value) {
      this._queueGroup = value.info.group
    }
  }

  /** Get current queue from the connected palette widget. */
  private _getPaletteCurrentQueue(): ProductionQueue | null {
    if (!this._paletteWidgetResolved) {
      if (this._paletteWidgetResolver) {
        this._paletteWidget = this._paletteWidgetResolver()
        this._paletteWidgetResolved = true
      } else {
        return this._currentQueue
      }
    }
    const palette = this._paletteWidget as Record<string, unknown> | null
    return (palette?.['currentQueue'] as ProductionQueue) ?? null
  }

  /** Set current queue on the connected palette widget. */
  private _setPaletteCurrentQueue(value: ProductionQueue | null): void {
    if (!this._paletteWidgetResolved) {
      if (this._paletteWidgetResolver) {
        this._paletteWidget = this._paletteWidgetResolver()
        this._paletteWidgetResolved = true
      } else {
        this._currentQueue = value
        return
      }
    }
    const palette = this._paletteWidget as Record<string, unknown> | null
    if (palette) {
      palette['currentQueue'] = value
    }
  }

  /** Set the palette widget resolver function.
   *
   * Called externally to inject the ProductionPaletteWidget lookup.
   */
  setPaletteWidgetResolver(resolver: () => unknown): void {
    this._paletteWidgetResolver = resolver
  }

  // ---------------------------------------------------------------------------
  // Tab selection
  // OpenRA 对照: SelectNextTab(bool reverse)
  // ---------------------------------------------------------------------------

  /** Select the next (or previous) tab in the current group.
   *
   * Prioritizes alerted queues (those with done items).
   *
   * OpenRA 对照: public bool SelectNextTab(bool reverse)
   */
  selectNextTab(reverse: boolean = false): boolean {
    if (!this._queueGroup) return true

    const group = this.groups.get(this._queueGroup)
    if (!group || group.tabs.length === 0) return true

    // Prioritize alerted queues
    const sorted = [...group.tabs]
      .map((t) => t.queue)
      .sort((a, b) => {
        const aDone = a.allQueued().some((i) => i.done) ? 1 : 0
        const bDone = b.allQueued().some((i) => i.done) ? 1 : 0
        return bDone - aDone // done = higher priority
      })

    if (reverse) sorted.reverse()

    const current = this._getPaletteCurrentQueue()
    let found = false
    let nextQueue: ProductionQueue | null = null

    for (const q of sorted) {
      if (found) {
        nextQueue = q
        break
      }
      if (q === current) {
        found = true
      }
    }

    if (!nextQueue && sorted.length > 0) {
      nextQueue = sorted[0]!
    }

    this._setPaletteCurrentQueue(nextQueue)
    return true
  }

  // ---------------------------------------------------------------------------
  // ActorChanged — update tabs when production actors change
  // OpenRA 对照: ActorChanged(Actor)
  // ---------------------------------------------------------------------------

  /** Update production tabs from the current set of active queues.
   *
   * Called when production actors are added/removed or their queue states change.
   *
   * OpenRA 对照: public void ActorChanged(Actor a)
   */
  actorChanged(queues: ProductionQueue[]): void {
    this._cachedQueueEnabledStates = queues.map((q) => ({
      queue: q,
      enabled: q.enabled,
    }))

    // Update each group
    for (const [, group] of this.groups) {
      group.update(
        queues.filter((q) => q.enabled && q.info.group === group.group),
      )
    }

    if (!this._queueGroup) return

    // If current group has no tabs, switch to another group
    const currentGroup = this.groups.get(this._queueGroup)
    if (!currentGroup || currentGroup.tabs.length === 0) {
      let newGroup: string | null = null
      for (const [key, g] of this.groups) {
        if (g.tabs.length > 0) {
          newGroup = key
          break
        }
      }
      if (newGroup) {
        this._queueGroup = newGroup
      }
    } else {
      // If current queue is no longer in the group, switch to first tab
      const current = this._getPaletteCurrentQueue()
      const tabQueues = currentGroup.tabs.map((t) => t.queue)
      if (current && !tabQueues.includes(current)) {
        this.selectNextTab(false)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Tick — handle continuous scroll and queue state changes
  // OpenRA 对照: Tick()
  // ---------------------------------------------------------------------------

  /** Per-frame update.
   *
   * Handles continuous scrolling when arrow buttons are held,
   * and detects queue enable/disable state changes.
   *
   * OpenRA 对照: public override void Tick()
   */
  override tick(): void {
    if (this._leftPressed) this._scroll(1)
    if (this._rightPressed) this._scroll(-1)

    // Check for queue enabled state changes
    let shouldUpdateQueues = false
    for (let i = 0; i < this._cachedQueueEnabledStates.length; i++) {
      const cached = this._cachedQueueEnabledStates[i]!
      if (cached.queue.enabled !== cached.enabled) {
        shouldUpdateQueues = true
        this._cachedQueueEnabledStates[i] = {
          queue: cached.queue,
          enabled: cached.queue.enabled,
        }
      }
    }

    if (shouldUpdateQueues) {
      for (const [, group] of this.groups) {
        group.update(
          this._cachedQueueEnabledStates
            .filter((c) => c.enabled && c.queue.info.group === group.group)
            .map((c) => c.queue),
        )
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Scroll
  // ---------------------------------------------------------------------------

  /** Scroll the tab bar by the given amount.
   *
   * OpenRA 对照: void Scroll(int amount)
   */
  private _scroll(amount: number): void {
    const scrollSpeed = 1 // Game.Settings.Game.UIScrollSpeed in full impl
    this._listOffset += amount * scrollSpeed
    this._listOffset = Math.min(
      0,
      Math.max(
        this.bounds.width -
          this._rightButtonRect.width -
          this._leftButtonRect.width -
          this._contentWidth,
        this._listOffset,
      ),
    )
  }

  // ---------------------------------------------------------------------------
  // Event handling
  // ---------------------------------------------------------------------------

  /** Handle events (both mouse and keyboard).
   *
   * OpenRA 对照: HandleMouseInput(MouseInput) + HandleKeyPress(KeyInput)
   */
  override handleEvent(event: WidgetEvent): boolean {
    const eventType = event.type

    // Keyboard events
    if (
      eventType === 'keydown' ||
      eventType === 'keyup' ||
      eventType === 'keypress'
    ) {
      return this._handleKeyEvent(event)
    }

    // Mouse events
    return this._handleMouseEvent(event)
  }

  /** Handle mouse input.
   *
   * OpenRA 对照: public override bool HandleMouseInput(MouseInput mi)
   */
  private _handleMouseEvent(event: WidgetEvent): boolean {
    const eventType = event.type
    const x = (event.clientX ?? 0) as number
    const y = (event.clientY ?? 0) as number

    // Scroll wheel
    if (eventType === 'wheel') {
      const deltaY = (event['deltaY'] as number) ?? 0
      this._scroll(deltaY)
      return true
    }

    // Only handle left button
    const button = (event['button'] as number) ?? 0
    if (button !== 0) return true

    // Down: take mouse focus
    if (eventType === 'mousedown' || eventType === 'pointerdown') {
      if (!this.takeMouseFocus()) return true

      if (!this.hasMouseFocus) return true

      // Determine which button (left/right arrow or tab) is pressed
      const leftHover = boundsContains(this._leftButtonRect, x, y)
      const rightHover = boundsContains(this._rightButtonRect, x, y)

      this._leftPressed = leftHover
      this._rightPressed = rightHover

      const leftDisabled = this._listOffset >= 0
      const rightDisabled =
        this._listOffset <=
        this.bounds.width -
          this._rightButtonRect.width -
          this._leftButtonRect.width -
          this._contentWidth

      if (this._leftPressed || this._rightPressed) {
        if (
          (this._leftPressed && !leftDisabled) ||
          (this._rightPressed && !rightDisabled)
        ) {
          ProductionTabsWidget._playSound(this.clickSound)
        } else {
          ProductionTabsWidget._playSound(this.clickDisabledSound)
        }
      }

      // Check if a production tab was clicked
      const offsetX =
        x - (boundsRight(this._leftButtonRect) - 1 + this._listOffset)

      if (offsetX > 0 && offsetX < this._contentWidth) {
        const tabIndex = Math.floor(offsetX / (this.tabWidth - 1))
        const group = this.groups.get(this._queueGroup ?? '')
        if (group && tabIndex < group.tabs.length) {
          this._setPaletteCurrentQueue(group.tabs[tabIndex]!.queue)
          ProductionTabsWidget._playSound(this.clickSound)
        }
      }

      return true
    }

    // Up: yield mouse focus
    if (eventType === 'mouseup' || eventType === 'pointerup') {
      if (this.hasMouseFocus) {
        return this.yieldMouseFocus()
      }
      return true
    }

    return false
  }

  /** Handle mouse focus yield.
   *
   * OpenRA 对照: YieldMouseFocus(MouseInput)
   */
  override yieldMouseFocus(): boolean {
    this._leftPressed = false
    this._rightPressed = false
    return super.yieldMouseFocus()
  }

  /** Handle keyboard input.
   *
   * OpenRA 对照: public override bool HandleKeyPress(KeyInput e)
   */
  private _handleKeyEvent(event: WidgetEvent): boolean {
    if (event.type !== 'keydown') return false

    // Build KeyInput for hotkey matching
    const ki = this._widgetEventToKeyInput(event)
    if (!ki) return false

    // Previous tab hotkey
    if (this.previousProductionTabKey.isActivatedBy(ki)) {
      ProductionTabsWidget._playSound(this.clickSound)
      return this.selectNextTab(true)
    }

    // Next tab hotkey
    if (this.nextProductionTabKey.isActivatedBy(ki)) {
      ProductionTabsWidget._playSound(this.clickSound)
      return this.selectNextTab(false)
    }

    return false
  }

  /** Convert WidgetEvent to KeyInput. */
  private _widgetEventToKeyInput(event: WidgetEvent): import('../../OpenRA.Game/Input/IInputHandler.js').KeyInput | null {
    const keyCode = this._keyStringToKeyCode(event.key ?? '')
    if (keyCode === 0 && !event.key) return null

    let modifiers = Modifiers.None
    if (event.ctrlKey) modifiers |= Modifiers.Ctrl
    if (event.altKey) modifiers |= Modifiers.Alt
    if (event.shiftKey) modifiers |= Modifiers.Shift
    if (event.metaKey) modifiers |= Modifiers.Meta

    return {
      event: 0,
      key: keyCode !== 0 ? keyCode : (event.key?.charCodeAt(0) ?? 0),
      modifiers,
      multiTapCount: 1,
      unicodeChar: event.key ?? ' ', // KeyInput.unicodeChar is string
      isRepeat: event['repeat'] === true,
    }
  }

  /** Map key string to key code. */
  private _keyStringToKeyCode(key: string): number {
    if (key.length === 1) {
      const ch = key.toUpperCase().charCodeAt(0)
      if ((ch >= 48 && ch <= 57) || (ch >= 65 && ch <= 90)) return ch
    }
    const map: Record<string, number> = {
      'Tab': 9,
      'Enter': 13,
      'Escape': 27,
      ' ': 32,
    }
    return map[key] ?? 0
  }

  // ---------------------------------------------------------------------------
  // Pick up completed building (delegated from external logic)
  // OpenRA 对照: ProductionTabsWidget.PickUpCompletedBuilding()
  // ---------------------------------------------------------------------------

  /** Pick up a completed building from the palette.
   *
   * Delegates to the connected ProductionPaletteWidget.
   */
  pickUpCompletedBuilding(): void {
    if (!this._paletteWidgetResolved && this._paletteWidgetResolver) {
      this._paletteWidget = this._paletteWidgetResolver()
      this._paletteWidgetResolved = true
    }
    const palette = this._paletteWidget as Record<string, unknown> | null
    const fn = palette?.['pickUpCompletedBuilding'] as (() => void) | undefined
    fn?.()
  }

  // ---------------------------------------------------------------------------
  // Sound playback
  // ---------------------------------------------------------------------------

  /** Play a sound via the static callback. */
  private static _playSound(soundName: string): void {
    ProductionTabsWidget.soundPlayer?.(soundName)
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // OpenRA 对照: Draw()
  // ---------------------------------------------------------------------------

  /** Render the production tabs as a DOM element.
   *
   * Renders a horizontal bar with:
   * - Background panel
   * - Left/right arrow buttons
   * - Tab buttons with queue names and done-indicator colors
   *
   * OpenRA 对照: public override void Draw()
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'production-tabs-widget')
    el.style.position = 'absolute'
    el.style.overflow = 'hidden'
    el.style.boxSizing = 'border-box'
    el.style.cursor = 'default'
    el.style.userSelect = 'none'

    if (this.id) {
      el.setAttribute('data-widget-id', this.id)
    }

    // Clear existing content
    while (el.firstChild) {
      el.removeChild(el.firstChild)
    }

    const groupKey = this._queueGroup
    if (!groupKey) return el

    const group = this.groups.get(groupKey)
    if (!group && !this._queueGroup) return el

    // Get tabs with buildable items
    const tabs =
      group?.tabs.filter((t) => t.queue.buildableItems().length > 0) ?? []

    if (tabs.length === 0) return el

    const rb = this.bounds
    const leftButtonRight = boundsRight(this._leftButtonRect)
    const rightButtonLeft = boundsLeft(this._rightButtonRect)

    // Background
    el.style.backgroundColor = '#0a1a30'
    el.style.border = '1px solid #1a3a5c'

    // Left arrow
    this._renderArrowButton(el, true)

    // Right arrow
    this._renderArrowButton(el, false)

    // Scrollable tab area
    const scrollArea = document.createElement('div')
    scrollArea.style.position = 'absolute'
    scrollArea.style.left = `${leftButtonRight}px`
    scrollArea.style.top = `${boundsTop(rb) + 1}px`
    scrollArea.style.width = `${rightButtonLeft - leftButtonRight - 1}px`
    scrollArea.style.height = `${rb.height - 2}px`
    scrollArea.style.overflow = 'hidden'

    const originX = this._listOffset

    let contentX = 0
    const currentQ = this._getPaletteCurrentQueue()

    for (const tab of tabs) {
      const tabEl = this._renderTab(tab, contentX + originX, currentQ)
      scrollArea.appendChild(tabEl)
      contentX += this.tabWidth - 1
    }

    this._contentWidth = contentX
    el.appendChild(scrollArea)

    return el
  }

  /** Render an arrow button (left or right). */
  private _renderArrowButton(
    container: HTMLElement,
    isLeft: boolean,
  ): void {
    const rect = isLeft ? this._leftButtonRect : this._rightButtonRect
    const button = document.createElement('div')

    button.style.position = 'absolute'
    button.style.left = `${boundsLeft(rect) - boundsLeft(this.bounds)}px`
    button.style.top = `${boundsTop(rect) - boundsTop(this.bounds)}px`
    button.style.width = `${rect.width}px`
    button.style.height = `${rect.height}px`
    button.style.backgroundColor = '#1e4d7a'
    button.style.border = '1px solid #2a5a8c'
    button.style.display = 'flex'
    button.style.alignItems = 'center'
    button.style.justifyContent = 'center'
    button.style.fontSize = '12px'
    button.style.color = '#8ab4f8'
    button.style.cursor = 'pointer'
    button.textContent = isLeft ? '◀' : '▶'

    container.appendChild(button)
  }

  /** Render a single tab button. */
  private _renderTab(
    tab: ProductionTab,
    x: number,
    currentQueue: ProductionQueue | null,
  ): HTMLElement {
    const tabEl = document.createElement('div')
    tabEl.style.position = 'absolute'
    tabEl.style.left = `${x}px`
    tabEl.style.top = '0px'
    tabEl.style.width = `${this.tabWidth}px`
    tabEl.style.height = '100%'
    tabEl.style.display = 'flex'
    tabEl.style.alignItems = 'center'
    tabEl.style.justifyContent = 'center'
    tabEl.style.boxSizing = 'border-box'

    const isCurrent = tab.queue === currentQueue
    const hasDone = tab.queue.allQueued().some((i) => i.done)

    if (isCurrent) {
      tabEl.style.backgroundColor = '#2a5a8c'
      tabEl.style.border = '2px solid #5a9adf'
    } else {
      tabEl.style.backgroundColor = '#0d2a4a'
      tabEl.style.border = '1px solid #1a3a5c'
    }

    tabEl.style.borderRadius = '2px'
    tabEl.style.cursor = 'pointer'

    const label = document.createElement('span')
    label.style.font = this.tabFont
    label.style.color = hasDone ? this.tabColorDone : this.tabColor
    label.textContent = tab.name
    tabEl.appendChild(label)

    return tabEl
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  /** Clean up resources. */
  override dispose(): void {
    this.groups.clear()
    this._cachedQueueEnabledStates = []
    this._paletteWidget = null
    this._paletteWidgetResolver = null
    super.dispose()
  }
}
