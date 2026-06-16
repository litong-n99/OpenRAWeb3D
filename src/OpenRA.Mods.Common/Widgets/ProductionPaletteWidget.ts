/**
 * ProductionPaletteWidget.ts — 生产面板 widget：网格显示可建造单位图标、进度时钟、成本叠加与热键标签
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/ProductionPaletteWidget.cs (649 lines)
 *
 * 核心范式转换:
 * - C# sprite-sheet + SpriteFont 图标/文本 bitmap 渲染 → HTML <div> grid + CSS conic-gradient 时钟 + <span> 文本叠加
 * - C# Animation.PlayFetchIndex() 时钟帧动画 → CSS conic-gradient() 根据 build progress 角度渲染
 * - C# WidgetUtils.DrawSpriteCentered(Sprite, Palette) → CSS background-image + data-icon 属性
 * - C# HotkeyReference.IsActivatedBy(e) → KeyboardEvent.keyCode 匹配
 * - C# ProductionQueue / PlayerResources 直接耦合 → 通过接口/回调注入（支持测试 mock）
 * - C# Game.Sound.PlayNotification → 静态可替换 SoundCallback
 * - C# TextNotificationsManager → 存根回调（TODO-16.X）
 * - C# SpriteFont.DrawTextWithContrast 对比文字 → CSS text-shadow (多层阴影模拟对比度)
 * - C# TouchEvent 滚动 → DOM wheel 事件
 */

import { InputWidget, boundsContains, boundsLeft, boundsTop } from '../../OpenRA.Game/Widgets/Widget.js'
import type { WidgetArgs, WidgetEvent, WidgetBounds } from '../../OpenRA.Game/Widgets/Widget.js'
import { HotkeyReference } from '../../OpenRA.Game/Input/HotkeyReference.js'
import { Modifiers } from '../../OpenRA.Game/Input/IInputHandler.js'

// ---------------------------------------------------------------------------
// Type stubs for game systems (mockable for tests)
// ---------------------------------------------------------------------------

import type { ActorInfoStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { ProductionQueue, ProductionItem } from '../Traits/Player/ProductionQueue.js'

// ---------------------------------------------------------------------------
// ReadyTextStyle / TextColor constants
// ---------------------------------------------------------------------------

/** Text style options for ready indicators.
 *
 * OpenRA 对照: ReadyTextStyleOptions { Solid, AlternatingColor, Blinking }
 */
export const ReadyTextStyle = {
  Solid: 'Solid' as const,
  AlternatingColor: 'AlternatingColor' as const,
  Blinking: 'Blinking' as const,
}
export type ReadyTextStyle = (typeof ReadyTextStyle)[keyof typeof ReadyTextStyle]

// ---------------------------------------------------------------------------
// ProductionIcon — data container for each palette cell
// OpenRA 对照: ProductionIcon class
// ---------------------------------------------------------------------------

/** Represents a single production icon in the palette grid.
 *
 * OpenRA 对照: ProductionIcon
 */
export interface ProductionIcon {
  /** The actor info for this unit/building. */
  actor: ActorInfoStub
  /** Actor internal name. */
  name: string
  /** Optional hotkey reference. */
  hotkey: HotkeyReference | null
  /** Sprite name (stub — in BA/Babylon.js this would be Sprite). */
  sprite: string | null
  /** Palette name. */
  palette: string
  /** Palette for the icon clock. */
  iconClockPalette: string
  /** Palette for the darken/not-buildable overlay. */
  iconDarkenPalette: string
  /** Top-left position in render bounds coordinates. */
  pos: { x: number; y: number }
  /** List of queued production items matching this actor. */
  queued: ProductionItem[]
  /** The production queue this icon belongs to. */
  productionQueue: ProductionQueue | null
}

// ---------------------------------------------------------------------------
// ProductionPaletteWidget — 生产面板 widget
// OpenRA 对照: ProductionPaletteWidget : Widget
// ---------------------------------------------------------------------------

/**
 * Production palette widget — displays a grid of producible actor icons.
 *
 * Each icon cell shows: actor sprite, cost text, hotkey label, clock progress overlay,
 * and state-dependent overlays (Ready, Hold, queue count).
 *
 * Supports: left-click to start/pick-up, right-click to cancel, middle-click to
 * force-cancel, keyboard hotkeys, scroll wheel for pagination, tooltip integration.
 *
 * OpenRA 对照: public class ProductionPaletteWidget : Widget
 */
export class ProductionPaletteWidget extends InputWidget {
  // ---- Static sound/text callbacks (replaceable for test / runtime) ----

  /** Sound player callback.
   *
   * OpenRA 对照: Game.Sound.PlayNotification(ModRules, player, "Sounds", name, null)
   */
  static soundPlayer: ((soundName: string) => void) | null = null

  /** Speech player callback.
   *
   * OpenRA 对照: Game.Sound.PlayNotification(ModRules, player, "Speech", name, faction)
   */
  static speechPlayer: ((speechName: string, faction: string) => void) | null = null

  /** Text notification display callback.
   *
   * OpenRA 对照: TextNotificationsManager.AddTransientLine(player, text)
   */
  static textNotificationDisplay: ((playerId: number, text: string | null) => void) | null = null

  /** Callback to issue an order to the world.
   *
   * OpenRA 对照: World.IssueOrder(Order)
   */
  static issueOrder: ((order: unknown) => void) | null = null

  /** Callback to set the current OrderGenerator.
   *
   * OpenRA 对照: World.OrderGenerator = generator
   */
  static setOrderGenerator: ((generator: unknown) => void) | null = null

  // ---- Configuration properties ----

  /** Text style for the ready indicator. */
  readyTextStyle: ReadyTextStyle = ReadyTextStyle.AlternatingColor

  /** Base text color for overlays. */
  textColor: string = '#FFFFFF'

  /** Alternate color for ready text (when style is AlternatingColor). */
  readyTextAltColor: string = '#FFD700'

  /** Number of columns in the icon grid. */
  columns: number = 3

  /** Icon cell width (pixels). */
  iconWidth: number = 64

  /** Icon cell height (pixels). */
  iconHeight: number = 48

  /** Margin between icon cells. */
  iconMarginX: number = 0
  iconMarginY: number = 0

  /** Sprite offset within the icon cell. */
  iconSpriteOffsetX: number = 0
  iconSpriteOffsetY: number = 0

  /** Offset for queued count text. */
  queuedOffsetX: number = 4
  queuedOffsetY: number = 2

  /** Offset for bulk delivery count text. */
  bulkOffsetX: number = 4
  bulkOffsetY: number = 2

  /** Text alignment for queued count. */
  queuedTextAlign: 'left' | 'center' | 'right' = 'left'

  /** Sound played on successful click. */
  clickSound: string = 'ClickSound'

  /** Sound played when click is rejected. */
  clickDisabledSound: string = 'ClickDisabledSound'

  /** Tooltip container widget ID. */
  tooltipContainerId: string | null = null

  /** Tooltip template name. */
  tooltipTemplate: string = 'PRODUCTION_TOOLTIP'

  /** Hotkey prefix (e.g., "F" for F1-F9). */
  hotkeyPrefix: string | null = null

  /** Number of hotkeys to assign. */
  hotkeyCount: number = 0

  /** Hotkey for selecting the production building. */
  selectProductionBuildingHotkey: HotkeyReference = new HotkeyReference()

  /** Animation name for the clock overlay. */
  clockAnimationName: string = 'clock'

  /** Clock animation sequence. */
  clockSequenceName: string = 'idle'

  /** Palette for the clock. */
  clockPalette: string = 'chrome'

  /** Darken overlay for unbuildable items. */
  notBuildableAnimationName: string = 'clock'
  notBuildableSequenceName: string = 'idle'
  notBuildablePalette: string = 'chrome'

  /** Font for overlay text. */
  overlayFont: string = '11px monospace'

  /** Symbols font key (for infinite symbol). */
  symbolsFont: string | null = null

  /** Whether to show remaining time text. */
  drawTime: boolean = true

  /** Text displayed when an item is done. */
  readyText: string = 'READY'

  /** Text displayed when an item is paused. */
  holdText: string = 'HOLD'

  /** Infinite symbol character. */
  infiniteSymbol: string = '∞'

  /** Minimum rows to show. */
  minimumRows: number = 4

  /** Maximum rows to show. */
  maximumRows: number = Number.MAX_SAFE_INTEGER

  /** Current row offset for scrolling. */
  iconRowOffset: number = 0

  /** Maximum row offset (constrains scroll). */
  maxIconRowOffset: number = Number.MAX_SAFE_INTEGER

  // ---- State ----

  /** Currently displayed icon count. */
  displayedIconCount: number = 0

  /** Total icon count. */
  totalIconCount: number = 0

  /** Callback fired when icon count changes. */
  onIconCountChanged: (oldCount: number, newCount: number) => void = () => {}

  /** Current tooltip icon (the icon the mouse is hovering over). */
  tooltipIcon: ProductionIcon | null = null

  /** Delegate to get the tooltip icon. */
  getTooltipIcon: () => ProductionIcon | null = () => this.tooltipIcon

  /** Current production queue being displayed. */
  private _currentQueue: ProductionQueue | null = null

  /** Cached list of hotkeys. */
  private _hotkeys: HotkeyReference[] = []

  /** Map of bounds rectangle -> production icon. */
  private _icons: Map<string, { rect: WidgetBounds; icon: ProductionIcon }> = new Map()

  /** Union bounds for all icons (used for event handling). */
  // @ts-expect-error: reserved for future event bounds optimization
  private _eventBounds: WidgetBounds = { x: 0, y: 0, width: 0, height: 0 }

  /** Cached owner for overlay refresh detection. */
  private _cachedQueueOwner: number = 0

  /** All buildable actor infos (computed from queue). */
  private _allBuildables: ActorInfoStub[] = []

  /** Cached tooltip container resolver. */
  private _tooltipContainerResolver: (() => ITooltipContainerStub | null) | null = null
  private _tooltipContainerCache: ITooltipContainerStub | null = null
  private _tooltipContainerCreated: boolean = false

  /** Track whether we're hovering on a specific icon for cursor purposes. */
  private _hoveredIconName: string | null = null

  constructor() {
    super()
    this.getTooltipIcon = () => this.tooltipIcon
  }

  // ---------------------------------------------------------------------------
  // CurrentQueue accessor
  // OpenRA 对照: ProductionPaletteWidget.CurrentQueue
  // ---------------------------------------------------------------------------

  /** Get or set the current production queue.
   *
   * Setting refreshes icons and icon overlays.
   */
  get currentQueue(): ProductionQueue | null {
    return this._currentQueue
  }

  set currentQueue(value: ProductionQueue | null) {
    this._currentQueue = value
    if (value !== null) {
      this._updateCachedProductionIconOverlays()
    }
    this.refreshIcons()
  }

  // ---------------------------------------------------------------------------
  // Scroll controls
  // OpenRA 对照: ScrollDown / CanScrollDown / ScrollUp / CanScrollUp / ScrollToTop
  // ---------------------------------------------------------------------------

  /** Check if we can scroll down. */
  get canScrollDown(): boolean {
    const count = this._allBuildables.length
    const totalRows = Math.ceil(count / this.columns)
    return this.iconRowOffset < totalRows - this.maxIconRowOffset
  }

  /** Scroll down by one row. */
  scrollDown(): void {
    if (this.canScrollDown) {
      this.iconRowOffset++
    }
  }

  /** Check if we can scroll up. */
  get canScrollUp(): boolean {
    return this.iconRowOffset > 0
  }

  /** Scroll up by one row. */
  scrollUp(): void {
    if (this.canScrollUp) {
      this.iconRowOffset--
    }
  }

  /** Scroll to the top. */
  scrollToTop(): void {
    this.iconRowOffset = 0
  }

  // ---------------------------------------------------------------------------
  // Buildable items query
  // OpenRA 对照: AllBuildables
  // ---------------------------------------------------------------------------

  /** Get all buildable items sorted by palette order.
   *
   * OpenRA 对照: IEnumerable<ActorInfo> AllBuildables
   */
  get allBuildables(): ActorInfoStub[] {
    if (!this._currentQueue) return []
    return this._allBuildables
  }

  // ---------------------------------------------------------------------------
  // Update cached buildables
  // ---------------------------------------------------------------------------

  /** Update the cached list of buildable items from the queue. */
  private _updateAllBuildables(): void {
    if (!this._currentQueue) {
      this._allBuildables = []
      return
    }
    this._allBuildables = this._currentQueue
      .allItems()
      .slice()
      .sort((a, b) => {
        const biA = this._getBuildPaletteOrder(a)
        const biB = this._getBuildPaletteOrder(b)
        return biA - biB
      })
  }

  /** Get the BuildPaletteOrder from an ActorInfo stub. */
  private _getBuildPaletteOrder(a: ActorInfoStub): number {
    // In OpenRA, this comes from BuildableInfo.BuildPaletteOrder
    const extended = a as unknown as Record<string, unknown>
    const bi = extended._buildableInfo as Record<string, unknown> | undefined
    return (bi?.['buildPaletteOrder'] as number) ?? 0
  }

  /** Get the BuildableInfo's IconPalette from an ActorInfo stub. */
  private _getIconPalette(a: ActorInfoStub): string {
    const extended = a as unknown as Record<string, unknown>
    const bi = extended._buildableInfo as Record<string, unknown> | undefined
    const palette = (bi?.['iconPalette'] as string) ?? 'chrome'
    // NOTE: In full implementation, player palette = palette + owner internal name
    return palette
  }

  /** Check if an actor has BuildingInfo (for completed building pickup). */
  private _hasBuildingInfo(a: ActorInfoStub): boolean {
    const extended = a as unknown as Record<string, unknown>
    return !!(extended._buildingInfo as Record<string, unknown>)
  }

  // ---------------------------------------------------------------------------
  // Tick — per-frame update
  // OpenRA 对照: ProductionPaletteWidget.Tick()
  // ---------------------------------------------------------------------------

  /** Per-frame update.
   *
   * Refreshes icons if the queue owner changes or items become available/unavailable.
   *
   * OpenRA 对照: override void Tick()
   */
  override tick(): void {
    this._updateAllBuildables()
    this.totalIconCount = this._allBuildables.length

    if (this._currentQueue !== null && !this._currentQueue.actor.isInWorld) {
      this._currentQueue = null
    }

    if (this._currentQueue !== null) {
      const queueOwnerId = this._getQueueOwnerId()
      if (queueOwnerId !== this._cachedQueueOwner) {
        this._updateCachedProductionIconOverlays()
      }
      this.refreshIcons()
    }
  }

  /** Get the current queue's owner actor ID. */
  private _getQueueOwnerId(): number {
    if (!this._currentQueue) return 0
    // In OpenRA: CurrentQueue.Actor.Owner.PlayerActor.ActorID
    // In stub: access actor.ownerId if available
    const actor = this._currentQueue.actor as unknown as Record<string, unknown>
    return (actor.ownerId as number) ?? 0
  }

  // ---------------------------------------------------------------------------
  // Mouse hover events (tooltip integration)
  // OpenRA 对照: MouseEntered / MouseExited
  // ---------------------------------------------------------------------------

  /** Handle mouse enter — show tooltip.
   *
   * OpenRA 对照: override void MouseEntered()
   */
  override mouseEntered(): void {
    if (!this.tooltipContainerId) return

    const container = this._getTooltipContainer()
    if (container) {
      container.setTooltip(this.tooltipTemplate, {
        player: undefined,
        getTooltipIcon: this.getTooltipIcon,
        world: undefined,
      })
    }
  }

  /** Handle mouse exit — remove tooltip.
   *
   * OpenRA 对照: override void MouseExited()
   */
  override mouseExited(): void {
    if (!this.tooltipContainerId || !this._tooltipContainerCreated) return

    const container = this._getTooltipContainer()
    if (container) {
      container.removeTooltip()
    }
  }

  /** Lazy-get the tooltip container. */
  private _getTooltipContainer(): ITooltipContainerStub | null {
    if (!this._tooltipContainerCreated) {
      this._tooltipContainerCreated = true
      if (this._tooltipContainerResolver) {
        this._tooltipContainerCache = this._tooltipContainerResolver()
      }
    }
    return this._tooltipContainerCache
  }

  /** Set the tooltip container resolver.
   *
   * Called externally to inject the tooltip container lookup function.
   */
  setTooltipContainerResolver(
    resolver: () => ITooltipContainerStub | null,
  ): void {
    this._tooltipContainerResolver = resolver
  }

  // ---------------------------------------------------------------------------
  // Mouse input handling
  // OpenRA 对照: HandleMouseInput(MouseInput)
  // ---------------------------------------------------------------------------

  /** Handle all events (mouse and keyboard).
   *
   * Dispatches to _handleMouseInput or _handleKeyPress based on event type.
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
      return this._handleKeyPress(event)
    }

    // Mouse events
    return this._handleMouseInput(event)
  }

  /** Handle mouse input events.
   *
   * Routes clicks to the appropriate icon handler, handles scroll wheel.
   *
   * OpenRA 对照: public override bool HandleMouseInput(MouseInput mi)
   */
  private _handleMouseInput(event: WidgetEvent): boolean {
    const eventType = event.type
    const x = (event.clientX ?? 0) as number
    const y = (event.clientY ?? 0) as number

    // Find the icon under the cursor
    const icon = this._findIconAt(x, y)

    // Track hover for tooltip
    if (eventType === 'mousemove' || eventType === 'pointermove') {
      this.tooltipIcon = icon || null
      this._hoveredIconName = icon?.name ?? null
      return icon !== null
    }

    // Handle scroll
    if (eventType === 'wheel') {
      const deltaY = (event['deltaY'] as number) ?? 0
      if (deltaY > 0 && this.canScrollDown) {
        this.scrollDown()
        ProductionPaletteWidget._playSound(this.clickSound)
        return true
      } else if (deltaY < 0 && this.canScrollUp) {
        this.scrollUp()
        ProductionPaletteWidget._playSound(this.clickSound)
        return true
      }
      return false
    }

    // No icon under cursor — ignore
    if (icon === null) return false

    // Eat mouse-up events (OpenRA pattern: only respond to Down)
    if (
      eventType !== 'mousedown' &&
      eventType !== 'pointerdown' &&
      eventType !== 'mouseup' &&
      eventType !== 'pointerup'
    ) {
      return eventType === 'mousemove' || eventType === 'pointermove'
    }

    if (eventType === 'mouseup' || eventType === 'pointerup') {
      return true // eat the event
    }

    // Determine button and modifiers
    const button = (event['button'] as number) ?? 0
    const modifiers = this._buildModifiers(event)

    return this._handleEvent(icon, button, modifiers)
  }

  /** Find the production icon at the given coordinates. */
  private _findIconAt(x: number, y: number): ProductionIcon | null {
    for (const [, entry] of this._icons) {
      if (boundsContains(entry.rect, x, y)) {
        return entry.icon
      }
    }
    return null
  }

  /** Build Modifiers bitmask from a DOM event. */
  private _buildModifiers(event: WidgetEvent): Modifiers {
    let mods = Modifiers.None
    if (event.ctrlKey) mods |= Modifiers.Ctrl
    if (event.altKey) mods |= Modifiers.Alt
    if (event.shiftKey) mods |= Modifiers.Shift
    if (event.metaKey) mods |= Modifiers.Meta
    return mods
  }

  // ---------------------------------------------------------------------------
  // HandleEvent — dispatch click to left/right/middle handler
  // OpenRA 对照: HandleEvent(ProductionIcon, MouseButton, Modifiers)
  // ---------------------------------------------------------------------------

  /** Handle a click event on an icon.
   *
   * OpenRA 对照: bool HandleEvent(ProductionIcon icon, MouseButton btn, Modifiers modifiers)
   */
  private _handleEvent(
    icon: ProductionIcon,
    button: number,
    modifiers: Modifiers,
  ): boolean {
    const startCount = (modifiers & Modifiers.Shift) !== 0 ? 5 : 1

    // For cancel count: Ctrl means cancel all (count = queue size), else startCount
    const allQueued = icon.productionQueue
      ? icon.productionQueue.allQueued()
      : []
    const cancelCount =
      (modifiers & Modifiers.Ctrl) !== 0 ? allQueued.length : startCount

    const item = icon.queued.length > 0 ? icon.queued[0] : null

    let handled = false
    if (button === 0) {
      // Left click
      handled = this._handleLeftClick(item, icon, startCount, modifiers)
    } else if (button === 2) {
      // Right click
      handled = this._handleRightClick(item, icon, cancelCount)
    } else if (button === 1) {
      // Middle click
      handled = this._handleMiddleClick(item, icon, cancelCount)
    }

    if (!handled) {
      ProductionPaletteWidget._playSound(this.clickDisabledSound)
    }

    return true
  }

  // ---------------------------------------------------------------------------
  // Left click handler
  // OpenRA 对照: HandleLeftClick(ProductionItem, ProductionIcon, int, Modifiers)
  // ---------------------------------------------------------------------------

  /** Handle left click on a production icon.
   *
   * Order:
   * 1. If item is done and is a building → start PlaceBuildingOrderGenerator
   * 2. If item is paused → resume it
   * 3. If buildable → start production
   *
   * OpenRA 对照: bool HandleLeftClick(...)
   */
  private _handleLeftClick(
    item: ProductionItem | null,
    icon: ProductionIcon,
    handleCount: number,
    modifiers: Modifiers,
  ): boolean {
    // #1: Pick up completed building
    if (this._pickUpCompletedBuildingIcon(item)) {
      ProductionPaletteWidget._playSound(this.clickSound)
      return true
    }

    // #2: Resume paused item
    if (item !== null && item.paused) {
      ProductionPaletteWidget._playSound(this.clickSound)
      if (icon.productionQueue && ProductionPaletteWidget.speechPlayer) {
        const faction = this._getFaction()
        ProductionPaletteWidget.speechPlayer(
          icon.productionQueue.info.queuedAudio ?? '',
          faction,
        )
      }
      if (ProductionPaletteWidget.textNotificationDisplay && icon.productionQueue) {
        ProductionPaletteWidget.textNotificationDisplay(
          this._getQueueOwnerId(),
          icon.productionQueue.info.queuedTextNotification,
        )
      }

      if (icon.productionQueue && ProductionPaletteWidget.issueOrder) {
        const order = this._createPauseProductionOrder(
          icon.productionQueue,
          icon.name,
          false,
        )
        ProductionPaletteWidget.issueOrder(order)
      }
      return true
    }

    // #3: Start production
    if (!this._currentQueue) return false

    const buildable = this._currentQueue
      .buildableItems()
      .find((a) => a.name === icon.name)

    if (buildable) {
      // Check affordability for pay-up-front queues
      if (this._currentQueue.info.payUpFront) {
        const cost = this._getProductionCost(buildable)
        if (cost > this._getPlayerCash()) {
          return false
        }
      }

      ProductionPaletteWidget._playSound(this.clickSound)

      const canQueueResult = this._currentQueue.canQueue(buildable)
      const isFirstItem = this._currentQueue.allQueued().length === 0

      if (isFirstItem) {
        if (ProductionPaletteWidget.speechPlayer) {
          ProductionPaletteWidget.speechPlayer(
            canQueueResult.notificationAudio ?? '',
            this._getFaction(),
          )
        }
        if (ProductionPaletteWidget.textNotificationDisplay) {
          ProductionPaletteWidget.textNotificationDisplay(
            this._getQueueOwnerId(),
            canQueueResult.notificationText,
          )
        }
      }

      if (canQueueResult.canQueue) {
        const queued = (modifiers & Modifiers.Ctrl) === 0
        if (ProductionPaletteWidget.issueOrder) {
          const order = this._createStartProductionOrder(
            this._currentQueue,
            icon.name,
            handleCount,
            queued,
          )
          ProductionPaletteWidget.issueOrder(order)
        }
        return true
      }
    }

    return false
  }

  /** Try to pick up a completed building.
   *
   * OpenRA 对照: PickUpCompletedBuildingIcon(ProductionItem)
   */
  private _pickUpCompletedBuildingIcon(
    item: ProductionItem | null,
  ): boolean {
    if (item === null) return false

    const actorInfo = this._currentQueue
      ?.allItems()
      .find((a) => a.name === item.item)
    if (!actorInfo) return false

    if (item.done && this._hasBuildingInfo(actorInfo)) {
      // Set World.OrderGenerator = new PlaceBuildingOrderGenerator(CurrentQueue, item.Item, worldRenderer)
      // For now, this is a stub
      if (ProductionPaletteWidget.setOrderGenerator && this._currentQueue) {
        ProductionPaletteWidget.setOrderGenerator({
          type: 'PlaceBuildingOrderGenerator',
          queue: this._currentQueue,
          itemName: item.item,
        })
      }
      return true
    }

    return false
  }

  // ---------------------------------------------------------------------------
  // Right click handler
  // OpenRA 对照: HandleRightClick(ProductionItem, ProductionIcon, int)
  // ---------------------------------------------------------------------------

  /** Handle right click — cancel or pause production.
   *
   * OpenRA 对照: bool HandleRightClick(...)
   */
  private _handleRightClick(
    item: ProductionItem | null,
    icon: ProductionIcon,
    handleCount: number,
  ): boolean {
    if (item === null) return false

    ProductionPaletteWidget._playSound(this.clickSound)

    if (!this._currentQueue) return false

    if (
      this._currentQueue.info.disallowPaused ||
      item.paused ||
      item.done ||
      item.totalCost === item.remainingCost ||
      !item.started
    ) {
      // Cancel immediately
      if (ProductionPaletteWidget.speechPlayer) {
        ProductionPaletteWidget.speechPlayer(
          this._currentQueue.info.cancelledAudio ?? '',
          this._getFaction(),
        )
      }
      if (ProductionPaletteWidget.textNotificationDisplay) {
        ProductionPaletteWidget.textNotificationDisplay(
          this._getQueueOwnerId(),
          this._currentQueue.info.cancelledTextNotification,
        )
      }

      if (ProductionPaletteWidget.issueOrder) {
        const order = this._createCancelProductionOrder(
          this._currentQueue,
          icon.name,
          handleCount,
        )
        ProductionPaletteWidget.issueOrder(order)
      }
    } else {
      // Pause the item
      if (ProductionPaletteWidget.speechPlayer) {
        ProductionPaletteWidget.speechPlayer(
          this._currentQueue.info.onHoldAudio ?? '',
          this._getFaction(),
        )
      }
      if (ProductionPaletteWidget.textNotificationDisplay) {
        ProductionPaletteWidget.textNotificationDisplay(
          this._getQueueOwnerId(),
          this._currentQueue.info.onHoldTextNotification,
        )
      }

      if (ProductionPaletteWidget.issueOrder) {
        const order = this._createPauseProductionOrder(
          this._currentQueue,
          icon.name,
          true,
        )
        ProductionPaletteWidget.issueOrder(order)
      }
    }

    return true
  }

  // ---------------------------------------------------------------------------
  // Middle click handler
  // OpenRA 对照: HandleMiddleClick(ProductionItem, ProductionIcon, int)
  // ---------------------------------------------------------------------------

  /** Handle middle click — force cancel (skip hold).
   *
   * OpenRA 对照: bool HandleMiddleClick(...)
   */
  private _handleMiddleClick(
    item: ProductionItem | null,
    icon: ProductionIcon,
    handleCount: number,
  ): boolean {
    if (item === null) return false

    ProductionPaletteWidget._playSound(this.clickSound)

    if (!this._currentQueue) return false

    if (ProductionPaletteWidget.speechPlayer) {
      ProductionPaletteWidget.speechPlayer(
        this._currentQueue.info.cancelledAudio ?? '',
        this._getFaction(),
      )
    }
    if (ProductionPaletteWidget.textNotificationDisplay) {
      ProductionPaletteWidget.textNotificationDisplay(
        this._getQueueOwnerId(),
        this._currentQueue.info.cancelledTextNotification,
      )
    }

    if (ProductionPaletteWidget.issueOrder) {
      const order = this._createCancelProductionOrder(
        this._currentQueue,
        icon.name,
        handleCount,
      )
      ProductionPaletteWidget.issueOrder(order)
    }

    return true
  }

  // ---------------------------------------------------------------------------
  // Order creation helpers
  // ---------------------------------------------------------------------------

  /** Create a StartProduction order. */
  private _createStartProductionOrder(
    queue: ProductionQueue,
    item: string,
    count: number,
    queued: boolean,
  ): unknown {
    return {
      orderName: 'StartProduction',
      subjectId: queue.actor.actorId,
      targetString: item,
      extraData: count,
      queued,
    }
  }

  /** Create a PauseProduction order. */
  private _createPauseProductionOrder(
    queue: ProductionQueue,
    item: string,
    pause: boolean,
  ): unknown {
    return {
      orderName: 'PauseProduction',
      subjectId: queue.actor.actorId,
      targetString: item,
      extraData: pause ? 1 : 0,
    }
  }

  /** Create a CancelProduction order. */
  private _createCancelProductionOrder(
    queue: ProductionQueue,
    item: string,
    count: number,
  ): unknown {
    return {
      orderName: 'CancelProduction',
      subjectId: queue.actor.actorId,
      targetString: item,
      extraData: count,
    }
  }

  // ---------------------------------------------------------------------------
  // Keyboard handling
  // OpenRA 对照: HandleKeyPress(KeyInput)
  // ---------------------------------------------------------------------------

  /** Internal key press handler.
   *
   * OpenRA 对照: public override bool HandleKeyPress(KeyInput e)
   */
  private _handleKeyPress(event: WidgetEvent): boolean {
    if (event.type === 'keyup' || !this._currentQueue) return false

    // Build KeyInput from WidgetEvent for HotkeyReference.isActivatedBy()
    const ki = this._widgetEventToKeyInput(event)
    if (!ki) return false

    // Check SelectProductionBuilding hotkey
    if (this.selectProductionBuildingHotkey.isActivatedBy(ki)) {
      return this._selectProductionBuilding()
    }

    // HACK: enable production if shift is pressed (OpenRA: e.Modifiers &= ~Modifiers.Shift)
    // Check if any hotkey matches
    for (const [, entry] of this._icons) {
      const icon = entry.icon
      if (icon.hotkey && icon.hotkey.isActivatedBy(ki)) {
        const batchModifiers = (event.shiftKey ?? false)
          ? Modifiers.Shift
          : Modifiers.None
        return this._handleEvent(icon, 0, batchModifiers)
      }
    }

    return false
  }

  /** Convert a WidgetEvent to a KeyInput for hotkey matching. */
  private _widgetEventToKeyInput(event: WidgetEvent): import('../../OpenRA.Game/Input/IInputHandler.js').KeyInput | null {
    const keyCode = this._keyStringToKeyCode(event.key ?? '')
    if (keyCode === 0 && !event.key) return null

    let modifiers = Modifiers.None
    if (event.ctrlKey) modifiers |= Modifiers.Ctrl
    if (event.altKey) modifiers |= Modifiers.Alt
    if (event.shiftKey) modifiers |= Modifiers.Shift
    if (event.metaKey) modifiers |= Modifiers.Meta

    return {
      event: event.type === 'keydown' ? 0 : 1, // 0=Down, 1=Up
      key: keyCode !== 0 ? keyCode : (event.key?.charCodeAt(0) ?? 0),
      modifiers,
      multiTapCount: 1,
      unicodeChar: event.key ?? ' ', // KeyInput.unicodeChar is string
      isRepeat: event['repeat'] === true,
    }
  }

  /** Convert key string to key code number.
   *
   * Maps common DOM key names to SDL KeyCode values.
   */
  private _keyStringToKeyCode(key: string): number {
    if (key.length === 1) {
      const ch = key.toUpperCase().charCodeAt(0)
      // Basic mapping: '0'-'9', 'A'-'Z'
      if (
        (ch >= 48 && ch <= 57) ||
        (ch >= 65 && ch <= 90)
      ) {
        return ch
      }
    }
    // Simple map for common special keys
    const map: Record<string, number> = {
      'F1': 58, 'F2': 59, 'F3': 60, 'F4': 61,
      'F5': 62, 'F6': 63, 'F7': 64, 'F8': 65,
      'F9': 66, 'F10': 67, 'F11': 68, 'F12': 69,
      'Enter': 13, 'Escape': 27, 'Backspace': 8,
      'Tab': 9, ' ': 32,
    }
    return map[key] ?? 0
  }

  /** Select the production building by centering the viewport on it.
   *
   * OpenRA 对照: SelectProductionBuilding()
   */
  private _selectProductionBuilding(): boolean {
    if (!this._currentQueue) return true

    const producer = this._currentQueue.mostLikelyProducer()
    if (!producer) return true

    ProductionPaletteWidget._playSound(this.clickSound)

    // In full implementation, this would:
    // 1. If facility is selected, center viewport on it
    // 2. Otherwise, select the facility
    // For now, check if we have a selection API
    return true
  }

  // ---------------------------------------------------------------------------
  // Cached overlays
  // OpenRA 对照: UpdateCachedProductionIconOverlays()
  // ---------------------------------------------------------------------------

  /** Update cached production icon overlays.
   *
   * OpenRA 对照: UpdateCachedProductionIconOverlays()
   */
  private _updateCachedProductionIconOverlays(): void {
    if (!this._currentQueue) return
    this._cachedQueueOwner = this._getQueueOwnerId()
    // NOTE: IProductionIconOverlay traits are not yet migrated.
    // Full implementation would discover overlay traits from player actor.
  }

  // ---------------------------------------------------------------------------
  // RefreshIcons
  // OpenRA 对照: RefreshIcons()
  // ---------------------------------------------------------------------------

  /** Refresh the icon grid from the current queue state.
   *
   * Rebuilds the _icons map by enumerating all buildable items
   * and assigning grid positions.
   *
   * OpenRA 对照: void RefreshIcons()
   */
  refreshIcons(): void {
    this._icons.clear()

    if (
      !this._currentQueue ||
      this._currentQueue.mostLikelyProducer() === null
    ) {
      if (this.displayedIconCount !== 0) {
        this.onIconCountChanged(this.displayedIconCount, 0)
        this.displayedIconCount = 0
      }
      return
    }

    const oldIconCount = this.displayedIconCount
    this.displayedIconCount = 0

    const rb = this.bounds
    const skip = this.iconRowOffset * this.columns
    const take = this.maxIconRowOffset * this.columns

    this._updateAllBuildables()
    const items = this._allBuildables.slice(skip, skip + take)

    for (const item of items) {
      const x = this.displayedIconCount % this.columns
      const y = Math.floor(this.displayedIconCount / this.columns)

      const cellX = boundsLeft(rb) + x * (this.iconWidth + this.iconMarginX)
      const cellY = boundsTop(rb) + y * (this.iconHeight + this.iconMarginY)
      const rect: WidgetBounds = {
        x: cellX,
        y: cellY,
        width: this.iconWidth,
        height: this.iconHeight,
      }

      const queued = this._currentQueue
        .allQueued()
        .filter((a) => a.item === item.name)

      const pi: ProductionIcon = {
        actor: item,
        name: item.name,
        hotkey:
          this.displayedIconCount < this.hotkeyCount
            ? (this._hotkeys[this.displayedIconCount] ?? null)
            : null,
        sprite: null, // stub — full impl uses Animation.Image
        palette: this._getIconPalette(item),
        iconClockPalette: this.clockPalette,
        iconDarkenPalette: this.notBuildablePalette,
        pos: { x: cellX, y: cellY },
        queued,
        productionQueue: this._currentQueue,
      }

      const key = `${cellX},${cellY},${item.name}`
      this._icons.set(key, { rect, icon: pi })
      this.displayedIconCount++
    }

    // Compute union event bounds
    this._computeEventBounds()

    if (oldIconCount !== this.displayedIconCount) {
      this.onIconCountChanged(oldIconCount, this.displayedIconCount)
    }
  }

  /** Compute the union bounds of all icon rects. */
  private _computeEventBounds(): void {
    if (this._icons.size === 0) {
      this._eventBounds = { x: 0, y: 0, width: 0, height: 0 }
      return
    }

    let minX = Number.MAX_SAFE_INTEGER
    let minY = Number.MAX_SAFE_INTEGER
    let maxX = 0
    let maxY = 0

    for (const [, entry] of this._icons) {
      const r = entry.rect
      if (r.x < minX) minX = r.x
      if (r.y < minY) minY = r.y
      if (r.x + r.width > maxX) maxX = r.x + r.width
      if (r.y + r.height > maxY) maxY = r.y + r.height
    }

    this._eventBounds = {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    }
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // OpenRA 对照: Draw()
  // ---------------------------------------------------------------------------

  /** Render the production palette as a DOM element.
   *
   * Generates a grid of icon cells, each with:
   * - Background color representing the sprite (stub)
   * - Clock progress via CSS conic-gradient
   * - Overlay text: Ready, Hold, Time, Queue Count
   * - Hotkey label in top-left corner
   *
   * OpenRA 对照: public override void Draw()
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'production-palette-widget')
    el.style.position = 'absolute'
    el.style.cursor = this.isDisabled() ? 'not-allowed' : (this._hoveredIconName ? 'pointer' : 'default')
    el.style.userSelect = 'none'
    el.style.overflow = 'hidden'
    el.style.boxSizing = 'border-box'

    if (this.id) {
      el.setAttribute('data-widget-id', this.id)
    }

    // Clear existing content
    while (el.firstChild) {
      el.removeChild(el.firstChild)
    }

    if (!this._currentQueue) {
      return el
    }

    this._updateAllBuildables()
    const buildableItems = this._currentQueue.buildableItems()
    const buildableNames = new Set(buildableItems.map((a) => a.name))

    // Build icon cells
    for (const [, entry] of this._icons) {
      const icon = entry.icon
      const cell = this._renderIconCell(icon, buildableNames)
      el.appendChild(cell)
    }

    // Set size to accommodate all icons
    const totalRows = Math.max(
      this.minimumRows,
      Math.ceil(this.displayedIconCount / this.columns),
    )
    el.style.minWidth = `${this.columns * (this.iconWidth + this.iconMarginX)}px`
    el.style.minHeight = `${totalRows * (this.iconHeight + this.iconMarginY)}px`

    return el
  }

  /** Render a single icon cell.
   *
   * Each cell is a <div> positioned absolutely at the cell's grid position.
   */
  private _renderIconCell(
    icon: ProductionIcon,
    buildableNames: Set<string>,
  ): HTMLElement {
    const cell = document.createElement('div')
    cell.className = 'production-icon-cell'
    cell.style.position = 'absolute'
    cell.style.left = `${icon.pos.x - boundsLeft(this.bounds)}px`
    cell.style.top = `${icon.pos.y - boundsTop(this.bounds)}px`
    cell.style.width = `${this.iconWidth}px`
    cell.style.height = `${this.iconHeight}px`
    cell.style.boxSizing = 'border-box'
    cell.style.border = '1px solid #1a3a5c'
    cell.style.borderRadius = '2px'
    cell.setAttribute('data-icon-name', icon.name)

    // Background color (stub for sprite rendering)
    const hasQueued = icon.queued.length > 0
    const isBuildable = buildableNames.has(icon.name)
    const firstItem = hasQueued ? icon.queued[0] : null

    if (hasQueued) {
      cell.style.backgroundColor = '#1e4d7a'
    } else if (isBuildable) {
      cell.style.backgroundColor = '#0d2a4a'
    } else {
      // Not buildable — darken overlay
      cell.style.backgroundColor = '#0a1a30'
      cell.style.opacity = '0.5'
    }

    // ---- Clock progress overlay (CSS conic-gradient) ----
    if (hasQueued && firstItem) {
      const progress = firstItem.totalTime > 0
        ? (firstItem.totalTime - firstItem.remainingTime) / firstItem.totalTime
        : 0
      const angle = Math.floor(progress * 360)

      const clockOverlay = document.createElement('div')
      clockOverlay.className = 'production-clock-overlay'
      clockOverlay.style.position = 'absolute'
      clockOverlay.style.inset = '4px'
      clockOverlay.style.borderRadius = '50%'
      clockOverlay.style.background = `conic-gradient(
        rgba(100,180,255,0.6) ${angle}deg,
        transparent ${angle}deg
      )`
      clockOverlay.style.pointerEvents = 'none'
      cell.appendChild(clockOverlay)
    } else if (!isBuildable) {
      // Darken overlay for unbuildable items (already applied via opacity)
    }

    // ---- Text overlays ----
    const overlay = document.createElement('div')
    overlay.className = 'production-overlays'
    overlay.style.position = 'absolute'
    overlay.style.inset = '0'
    overlay.style.pointerEvents = 'none'
    overlay.style.display = 'flex'
    overlay.style.flexDirection = 'column'
    overlay.style.alignItems = 'center'
    overlay.style.justifyContent = 'center'
    overlay.style.font = this.overlayFont
    overlay.style.textAlign = 'center'

    if (hasQueued && firstItem) {
      if (firstItem.done) {
        // Ready text
        const readySpan = this._createTextSpan('READY', this.textColor)
        overlay.appendChild(readySpan)
      } else if (firstItem.paused) {
        // Hold text
        const holdSpan = this._createTextSpan('HOLD', this.textColor)
        overlay.appendChild(holdSpan)
      } else if (this.drawTime) {
        // Time remaining
        const remaining = this._currentQueue
          ? this._currentQueue.remainingTimeActual(firstItem)
          : firstItem.remainingTimeActual
        const timeText = ProductionPaletteWidget.formatTime(remaining, 25)
        const timeSpan = this._createTextSpan(timeText, this.textColor)
        overlay.appendChild(timeSpan)
      }

      // Queue count (bottom-left)
      if (!firstItem.infinite && (icon.queued.length > 1)) {
        const countLabel = document.createElement('span')
        countLabel.style.position = 'absolute'
        countLabel.style.left = `${this.queuedOffsetX}px`
        countLabel.style.top = `${this.queuedOffsetY}px`
        countLabel.style.font = this.overlayFont
        countLabel.style.color = this.textColor
        countLabel.textContent = `${icon.queued.length}`
        cell.appendChild(countLabel)
      }

      // Infinite symbol (top-left)
      if (firstItem.infinite) {
        const infiniteLabel = document.createElement('span')
        infiniteLabel.style.position = 'absolute'
        infiniteLabel.style.left = `${this.queuedOffsetX}px`
        infiniteLabel.style.top = `${this.queuedOffsetY}px`
        infiniteLabel.style.font = this.overlayFont
        infiniteLabel.style.color = this.textColor
        infiniteLabel.textContent = this.infiniteSymbol
        cell.appendChild(infiniteLabel)
      }
    }

    // ---- Hotkey label (top-left corner) ----
    if (icon.hotkey) {
      const hotkeyLabel = document.createElement('span')
      hotkeyLabel.style.position = 'absolute'
      hotkeyLabel.style.top = '1px'
      hotkeyLabel.style.left = '1px'
      hotkeyLabel.style.font = this.overlayFont
      hotkeyLabel.style.color = '#FFD700'
      hotkeyLabel.style.textShadow = '0 0 3px black'
      // Display hotkey reference name (keys array formatted)
      hotkeyLabel.textContent = icon.hotkey.getValue().displayString()
      cell.appendChild(hotkeyLabel)
    }

    cell.appendChild(overlay)
    return cell
  }

  /** Create a text span with text-shadow contrast effect. */
  private _createTextSpan(text: string, color: string): HTMLSpanElement {
    const span = document.createElement('span')
    span.textContent = text
    span.style.color = color
    span.style.textShadow = [
      '-1px -1px 0 #000',
      '1px -1px 0 #000',
      '1px 1px 0 #000',
      '-1px 1px 0 #000',
    ].join(', ')
    span.style.font = this.overlayFont
    return span
  }

  // ---------------------------------------------------------------------------
  // Cursor
  // OpenRA 对照: GetCursor(int2)
  // ---------------------------------------------------------------------------

  /** Get the cursor for a position.
   *
   * If the cursor is over an icon, returns the default cursor;
   * otherwise returns null (pass through).
   *
   * OpenRA 对照: public override string GetCursor(int2 pos)
   */
  override getCursor(pos: { x: number; y: number }): string | null {
    const icon = this._findIconAt(pos.x, pos.y)
    return icon !== null ? 'pointer' : null
  }

  // ---------------------------------------------------------------------------
  // Utility: FormatTime — format remaining time in ticks to mm:ss
  // OpenRA 对照: WidgetUtils.FormatTime(int, int) / FormatTime(int, IWorld world)
  // ---------------------------------------------------------------------------

  /** Format remaining time in ticks to a human-readable string.
   *
   * OpenRA 对照: WidgetUtils.FormatTime(int ticks, int timestep)
   *
   * @param remaining — remaining ticks
   * @param timestep — ticks per second (default 25 for OpenRA)
   * @returns formatted string like "0:42"
   */
  static formatTime(remaining: number, timestep: number = 25): string {
    if (remaining <= 0) return '0:00'
    const totalSeconds = Math.ceil(remaining / timestep)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${String(seconds).padStart(2, '0')}`
  }

  // ---------------------------------------------------------------------------
  // Sound playback
  // ---------------------------------------------------------------------------

  /** Play a sound via the static callback. */
  private static _playSound(soundName: string): void {
    ProductionPaletteWidget.soundPlayer?.(soundName)
  }

  // ---------------------------------------------------------------------------
  // Stub helpers (depend on interfaces that may be mocked in tests)
  // ---------------------------------------------------------------------------

  /** Get the player's cash + resources total. */
  private _getPlayerCash(): number {
    // In full implementation, this would go through the queue's PlayerResources
    if (!this._currentQueue) return 0
    const queuePriv = this._currentQueue as unknown as Record<string, unknown>
    const playerResources = queuePriv['playerResources'] as Record<string, unknown> | undefined
    return (playerResources?.['getCashAndResources'] as (() => number) | undefined)?.() ?? 0
  }

  /** Get the production cost for a unit. */
  private _getProductionCost(unit: ActorInfoStub): number {
    if (this._currentQueue) {
      const queuePriv = this._currentQueue as unknown as Record<string, unknown>
      const getCost = queuePriv['_getProductionCost'] as ((u: ActorInfoStub) => number) | undefined
      if (getCost) return getCost.call(this._currentQueue, unit)
    }
    const extended = unit as unknown as Record<string, unknown>
    return (extended._cost as number) ?? 0
  }

  /** Get the faction name of the queue owner. */
  private _getFaction(): string {
    return ''
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  /** Clean up resources. */
  override dispose(): void {
    this._icons.clear()
    this._tooltipContainerCache = null
    this._tooltipContainerResolver = null
    super.dispose()
  }
}

// ---------------------------------------------------------------------------
// ITooltipContainerStub — minimal interface for tooltip containers
// ---------------------------------------------------------------------------

/**
 * Minimal interface for tooltip containers.
 *
 * ProductionPaletteWidget only needs setTooltip/removeTooltip,
 * so we define a lightweight interface here to avoid circular deps.
 *
 * OpenRA 对照: TooltipContainerWidget
 */
export interface ITooltipContainerStub {
  setTooltip(template: string, args: WidgetArgs): void
  removeTooltip(): void
}
