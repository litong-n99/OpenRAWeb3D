/**
 * SupportPowersWidget.ts — 支援能力图标条控件: 显示冷却倒计时、激活热键、准备脉冲
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/SupportPowersWidget.cs (298 lines)
 *
 * 核心范式转换:
 * - C# SpriteFont.DrawTextWithContrast() bitmap 文本 → CSS DOM 文本 + text-shadow
 * - C# Animation(clock) 时钟动画 sprite → Canvas 2D 圆环倒计时 (conic-gradient)
 * - C# WidgetUtils.DrawSpriteCentered() → CSS background-image 居中 + flexbox
 * - C# HandleMouseInput(MouseInput) → DOM click/mousemove 事件
 * - C# HandleKeyPress(KeyInput) + HotkeyReference → DOM keydown + Hotkey.isActivatedBy
 * - C# TooltipContainerWidget Lazy<T> → 可选 tooltip delegate
 * - C# Game.Sound.PlayToPlayer + Game.Sound.PlayNotification → 可替换声音回调
 * - C# Game.Renderer.EnableAntialiasingFilter() → CSS image-rendering: auto
 * - C# IconSize: int2 → { width: number, height: number }
 */

import { Widget } from '../../OpenRA.Game/Widgets/Widget.js'
import type { WidgetArgs, WidgetEvent } from '../../OpenRA.Game/Widgets/Widget.js'
import { HotkeyReference } from '../../OpenRA.Game/Input/HotkeyReference.js'
import { keyName } from '../../OpenRA.Game/Input/Keycode.js'
import { Modifiers } from '../../OpenRA.Game/Input/IInputHandler.js'

// ---------------------------------------------------------------------------
// SupportPowerIcon — 单个支援能力图标数据
// OpenRA 对照: SupportPowersWidget.SupportPowerIcon
// ---------------------------------------------------------------------------

/**
 * Data for a single support power icon in the widget.
 *
 * OpenRA 对照: SupportPowersWidget.SupportPowerIcon
 */
export interface SupportPowerIcon {
  /** The support power instance. */
  power: SupportPowerInstanceStub

  /** Screen position (top-left corner). */
  pos: { x: number; y: number }

  /** The sprite image URL or canvas for the icon. */
  sprite: string | null

  /** Palette name for the icon sprite. */
  palette: string

  /** Palette name for the clock overlay. */
  iconClockPalette: string

  /** Hotkey reference (null if beyond hotkey count). */
  hotkey: HotkeyReference | null
}

// ---------------------------------------------------------------------------
// SupportPowerInstanceStub — minimal power instance interface
// OpenRA 对照: SupportPowerInstance
// ---------------------------------------------------------------------------

/**
 * Minimal interface for a support power instance.
 *
 * OpenRA 对照: SupportPowerInstance (key properties)
 */
export interface SupportPowerInstanceStub {
  readonly key: string
  readonly ready: boolean
  readonly active: boolean
  readonly disabled: boolean
  readonly totalTicks: number
  readonly remainingTicks: number

  /** Activate / target the power. */
  target(): void

  /** Info for the power. */
  readonly info: SupportPowerInfoStub

  /** Custom overlay text override (null = use default). */
  iconOverlayTextOverride(): string | null
}

// ---------------------------------------------------------------------------
// SupportPowerInfoStub — minimal power info interface
// OpenRA 对照: SupportPowerInfo
// ---------------------------------------------------------------------------

/**
 * Minimal interface for support power info.
 *
 * OpenRA 对照: SupportPowerInfo
 */
export interface SupportPowerInfoStub {
  readonly name?: string
  readonly description?: string
  readonly iconImage?: string
  readonly icon?: string
  readonly iconPalette?: string
  readonly supportPowerPaletteOrder: number

  /** Sound played when power is ready. */
  readonly chargeSound?: string

  /** Sound played when insufficient power. */
  readonly insufficientPowerSound?: string
  readonly insufficientPowerSpeechNotification?: string
  readonly insufficientPowerTextNotification?: string

  /** Charge time in ticks. */
  readonly chargeInterval?: number
  readonly chargeTicks?: number
}

// ---------------------------------------------------------------------------
// SupportPowerManagerStub — minimal SPM interface
// OpenRA 对照: SupportPowerManager
// ---------------------------------------------------------------------------

/**
 * Minimal interface for SupportPowerManager.
 *
 * OpenRA 对照: SupportPowerManager
 */
export interface SupportPowerManagerStub {
  readonly self: { owner: { faction?: { internalName?: string } } }
  readonly powers: ReadonlyMap<string, SupportPowerInstanceStub>
}

// ---------------------------------------------------------------------------
// ITooltipContainer — tooltip display delegate
// OpenRA 对照: TooltipContainerWidget
// ---------------------------------------------------------------------------

/**
 * Minimal tooltip container interface.
 *
 * OpenRA 对照: TooltipContainerWidget
 */
export interface ITooltipContainer {
  setTooltip(template: string, args: Record<string, unknown>): void
  removeTooltip(): void
}

// ---------------------------------------------------------------------------
// Sound delegates
// ---------------------------------------------------------------------------

/**
 * Sound playback delegate types.
 */
export type SupportPowerSoundDelegate = {
  playToPlayer: (category: string, owner: unknown, soundName: string) => void
  playNotification: (
    rules: unknown,
    owner: unknown,
    category: string,
    notification: string,
    faction: string,
  ) => void
}

/**
 * Text notifications delegate.
 */
export type TextNotificationDelegate = {
  addTransientLine: (owner: unknown, text: string) => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// SupportPowersWidget
// OpenRA 对照: SupportPowersWidget : Widget
// ---------------------------------------------------------------------------

/**
 * Widget that displays a grid of support power icons with cooldown overlays.
 *
 * OpenRA 对照: SupportPowersWidget
 *
 * Icons are laid out either horizontally or vertically.
 * Each icon shows:
 * - Power sprite image
 * - Clock overlay (cooldown/charge progress as a partial circle arc)
 * - Overlay text (READY / HOLD / time remaining)
 * - Hotkey label
 *
 * Click activates the support power. Right-click cancels.
 */
export class SupportPowersWidget extends Widget {
  /** "READY" text displayed when power is fully charged.
   *
   * OpenRA 对照: SupportPowersWidget.ReadyText
   */
  readyText: string = 'READY'

  /** "HOLD" text displayed when power is inactive/disabled.
   *
   * OpenRA 对照: SupportPowersWidget.HoldText
   */
  holdText: string = 'HOLD'

  /** Font family for overlay text.
   *
   * OpenRA 对照: SupportPowersWidget.OverlayFont
   */
  overlayFont: string = 'TinyBold'

  /** Icon size in pixels.
   *
   * OpenRA 对照: SupportPowersWidget.IconSize (int2)
   */
  iconSize: { width: number; height: number } = { width: 64, height: 48 }

  /** Margin between icons in pixels.
   *
   * OpenRA 对照: SupportPowersWidget.IconMargin (int)
   */
  iconMargin: number = 10

  /** Offset for the icon sprite within the icon rect.
   *
   * OpenRA 对照: SupportPowersWidget.IconSpriteOffset (int2)
   */
  iconSpriteOffset: { x: number; y: number } = { x: 0, y: 0 }

  /** Tooltip container widget ID.
   *
   * OpenRA 对照: SupportPowersWidget.TooltipContainer
   */
  tooltipContainer: string | null = null

  /** Tooltip template name.
   *
   * OpenRA 对照: SupportPowersWidget.TooltipTemplate
   */
  tooltipTemplate: string = 'SUPPORT_POWER_TOOLTIP'

  /** Hotkey prefix (e.g., "SupportPower").
   *
   * OpenRA 对照: SupportPowersWidget.HotkeyPrefix
   */
  hotkeyPrefix: string | null = null

  /** Number of hotkeys to bind.
   *
   * OpenRA 对照: SupportPowersWidget.HotkeyCount
   */
  hotkeyCount: number = 0

  /** Layout direction: true = horizontal, false = vertical.
   *
   * OpenRA 对照: SupportPowersWidget.Horizontal
   */
  horizontal: boolean = false

  /** Number of icons currently displayed.
   *
   * OpenRA 对照: SupportPowersWidget.IconCount
   */
  iconCount: number = 0

  /** Callback when icon count changes.
   *
   * OpenRA 对照: SupportPowersWidget.OnIconCountChanged
   */
  onIconCountChanged: ((oldCount: number, newCount: number) => void) | null = null

  /** Currently hovered/tooltip icon.
   *
   * OpenRA 对照: SupportPowersWidget.TooltipIcon
   */
  tooltipIcon: SupportPowerIcon | null = null

  /** Function to get the current tooltip icon.
   *
   * OpenRA 对照: SupportPowersWidget.GetTooltipIcon
   */
  getTooltipIcon: (() => SupportPowerIcon | null) | null = null

  /** Reference to SupportPowerManager.
   *
   * OpenRA 对照: SupportPowersWidget.spm
   */
  spm: SupportPowerManagerStub | null = null

  /** Resolved hotkey references. */
  private _hotkeys: (HotkeyReference | null)[] = []

  /** Currently displayed icons. */
  private _icons: SupportPowerIcon[] = []

  /** Icon rectangles (for hit testing). */
  private _iconRects: Map<SupportPowerIcon, { x: number; y: number; width: number; height: number }> = new Map()

  /** Event bounds (union of all icon rects).
   *
   * OpenRA 对照: SupportPowersWidget.eventBounds
   */
  private _eventBounds: { x: number; y: number; width: number; height: number } = {
    x: 0, y: 0, width: 0, height: 0,
  }

  /** Sound delegate. */
  sound: SupportPowerSoundDelegate | null = null

  /** Text notification delegate. */
  textNotifications: TextNotificationDelegate | null = null

  /** Hotkey resolver for mapping prefix + index to HotkeyReference. */
  hotkeyResolver: ((keyName: string) => HotkeyReference | null) | null = null

  /** Tooltip container delegate (lazy). */
  private _tooltipContainerDelegate: ITooltipContainer | null = null

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  constructor() {
    super()
    this.getTooltipIcon = () => this.tooltipIcon
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // OpenRA 对照: SupportPowersWidget.Initialize(WidgetArgs)
  // ---------------------------------------------------------------------------

  /**
   * Initialize widget and resolve hotkeys.
   *
   * OpenRA 对照: SupportPowersWidget.Initialize(WidgetArgs)
   */
  override initialize(args: WidgetArgs): void {
    super.initialize(args)

    if (this.hotkeyCount > 0 && this.hotkeyPrefix) {
      this._hotkeys = this._resolveHotkeys(this.hotkeyPrefix, this.hotkeyCount)
    }
  }

  /**
   * Resolve hotkey references for given prefix and count.
   */
  private _resolveHotkeys(prefix: string, count: number): (HotkeyReference | null)[] {
    if (!this.hotkeyResolver) return new Array(count).fill(null)

    const result: (HotkeyReference | null)[] = []
    for (let i = 0; i < count; i++) {
      const keyName = `${prefix}${String(i + 1).padStart(2, '0')}`
      result.push(this.hotkeyResolver(keyName))
    }
    return result
  }

  // ---------------------------------------------------------------------------
  // Font measurement helper
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Icon refresh
  // OpenRA 对照: SupportPowersWidget.RefreshIcons()
  // ---------------------------------------------------------------------------

  /**
   * Rebuild the icon list from current SupportPowerManager state.
   *
   * OpenRA 对照: SupportPowersWidget.RefreshIcons()
   */
  refreshIcons(): void {
    if (!this.spm) {
      this._icons = []
      this._iconRects.clear()
      this.iconCount = 0
      return
    }

    const oldIconCount = this.iconCount

    // Filter and sort powers
    const powers = Array.from(this.spm.powers.values())
      .filter((p) => !p.disabled)
      .sort((a, b) => a.info.supportPowerPaletteOrder - b.info.supportPowerPaletteOrder)

    this._icons = []
    this._iconRects.clear()
    this.iconCount = 0

    const rx = this.bounds.x
    const ry = this.bounds.y

    for (const p of powers) {
      const idx = this.iconCount
      let rect: { x: number; y: number; width: number; height: number }

      if (this.horizontal) {
        rect = {
          x: rx + idx * (this.iconSize.width + this.iconMargin),
          y: ry,
          width: this.iconSize.width,
          height: this.iconSize.height,
        }
      } else {
        rect = {
          x: rx,
          y: ry + idx * (this.iconSize.height + this.iconMargin),
          width: this.iconSize.width,
          height: this.iconSize.height,
        }
      }

      const icon: SupportPowerIcon = {
        power: p,
        pos: { x: rect.x, y: rect.y },
        sprite: p.info.iconImage ?? null,
        palette: p.info.iconPalette ?? 'chrome',
        iconClockPalette: 'chrome',
        hotkey: idx < this.hotkeyCount ? (this._hotkeys[idx] ?? null) : null,
      }

      this._icons.push(icon)
      this._iconRects.set(icon, rect)
      this.iconCount++
    }

    // Compute event bounds (union of all icon rects)
    if (this._icons.length > 0) {
      let left = Infinity
      let top = Infinity
      let right = -Infinity
      let bottom = -Infinity

      for (const rect of this._iconRects.values()) {
        left = Math.min(left, rect.x)
        top = Math.min(top, rect.y)
        right = Math.max(right, rect.x + rect.width)
        bottom = Math.max(bottom, rect.y + rect.height)
      }

      this._eventBounds = {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      }
    } else {
      this._eventBounds = { x: 0, y: 0, width: 0, height: 0 }
    }

    if (oldIconCount !== this.iconCount && this.onIconCountChanged) {
      this.onIconCountChanged(oldIconCount, this.iconCount)
    }
  }

  // ---------------------------------------------------------------------------
  // Click handler
  // OpenRA 对照: SupportPowersWidget.ClickIcon(SupportPowerIcon)
  // ---------------------------------------------------------------------------

  /**
   * Handle click on a support power icon.
   *
   * OpenRA 对照: SupportPowersWidget.ClickIcon(clicked)
   *
   * @param clicked — the icon that was clicked
   */
  clickIcon(clicked: SupportPowerIcon): void {
    if (!clicked.power.active) {
      // Play insufficient power sound
      if (this.sound && clicked.power.info.insufficientPowerSound) {
        this.sound.playToPlayer(
          'UI',
          this.spm?.self.owner,
          clicked.power.info.insufficientPowerSound,
        )
      }

      if (
        this.sound &&
        clicked.power.info.insufficientPowerSpeechNotification
      ) {
        this.sound.playNotification(
          null,
          this.spm?.self.owner,
          'Speech',
          clicked.power.info.insufficientPowerSpeechNotification,
          this.spm?.self.owner?.faction?.internalName ?? '',
        )
      }

      if (
        this.textNotifications &&
        clicked.power.info.insufficientPowerTextNotification
      ) {
        this.textNotifications.addTransientLine(
          this.spm?.self.owner,
          clicked.power.info.insufficientPowerTextNotification,
        )
      }
    } else {
      clicked.power.target()
    }
  }

  // ---------------------------------------------------------------------------
  // Overlay text
  // ---------------------------------------------------------------------------

  /**
   * Get the overlay text for a power icon.
   *
   * @param power — the power instance
   * @returns text to display above the icon
   */
  private _getOverlayText(power: SupportPowerInstanceStub): string {
    const custom = power.iconOverlayTextOverride()
    if (custom !== null) return custom

    if (power.ready) return this.readyText
    if (!power.active) return this.holdText
    return this._formatTime(power.remainingTicks)
  }

  /**
   * Format ticks into a human-readable time string (MM:SS).
   *
   * OpenRA 对照: WidgetUtils.FormatTime(ticks, timestep)
   *
   * @param ticks — remaining ticks
   * @returns formatted time string
   */
  private _formatTime(ticks: number): string {
    // Default timestep: 25 ticks per second (matching OpenRA default)
    const seconds = Math.ceil(ticks / 25)
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${String(secs).padStart(2, '0')}`
  }

  // ---------------------------------------------------------------------------
  // Render
  // OpenRA 对照: SupportPowersWidget.Draw()
  // ---------------------------------------------------------------------------

  /**
   * Render the support powers widget to a DOM element.
   *
   * OpenRA 对照: SupportPowersWidget.Draw()
   *
   * @returns HTMLElement — container with icon grid
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'support-powers-widget')
    el.style.position = 'absolute'
    el.style.display = 'flex'
    el.style.flexDirection = this.horizontal ? 'row' : 'column'
    el.style.gap = `${this.iconMargin}px`

    // Clear children
    while (el.lastChild) {
      el.removeChild(el.lastChild)
    }

    // Render each icon
    for (const icon of this._icons) {
      const iconEl = this._renderIcon(icon)
      el.appendChild(iconEl)
    }

    return el
  }

  /**
   * Render a single support power icon element.
   *
   * @param icon — icon data
   * @returns HTMLElement for the icon
   */
  private _renderIcon(icon: SupportPowerIcon): HTMLElement {
    const { width, height } = this.iconSize

    const container = document.createElement('div')
    container.className = 'support-power-icon'
    container.style.position = 'relative'
    container.style.width = `${width}px`
    container.style.height = `${height}px`
    container.style.cursor = 'pointer'
    container.style.border = '1px solid rgba(255,255,255,0.3)'
    container.style.borderRadius = '2px'
    container.style.overflow = 'hidden'
    container.dataset.powerKey = icon.power.key

    // ---- Icon sprite ----
    if (icon.sprite) {
      const img = document.createElement('img')
      img.src = icon.sprite
      img.style.width = '100%'
      img.style.height = '100%'
      img.style.objectFit = 'contain'
      img.style.imageRendering = 'auto'
      container.appendChild(img)
    } else {
      // Fallback: colored rectangle
      const fallback = document.createElement('div')
      fallback.style.width = '100%'
      fallback.style.height = '100%'
      fallback.style.backgroundColor = '#333'
      container.appendChild(fallback)
    }

    // ---- Clock overlay (cooldown ring) ----
    const power = icon.power
    if (!power.ready) {
      const clockOverlay = document.createElement('div')
      clockOverlay.className = 'support-power-clock'
      clockOverlay.style.position = 'absolute'
      clockOverlay.style.top = '0'
      clockOverlay.style.left = '0'
      clockOverlay.style.width = '100%'
      clockOverlay.style.height = '100%'
      clockOverlay.style.pointerEvents = 'none'

      // Draw clock as a partial ring using conic-gradient
      const progress =
        power.totalTicks > 0
          ? (power.totalTicks - power.remainingTicks) / power.totalTicks
          : 0
      const angle = Math.round(progress * 360)

      clockOverlay.style.background = `
        conic-gradient(
          rgba(0, 255, 0, 0.7) ${angle}deg,
          transparent ${angle}deg
        )
      `
      clockOverlay.style.borderRadius = '50%'
      clockOverlay.style.width = '70%'
      clockOverlay.style.height = '70%'
      clockOverlay.style.top = '15%'
      clockOverlay.style.left = '15%'
      container.appendChild(clockOverlay)
    } else if (power.ready) {
      // Ready pulse indicator
      const pulseOverlay = document.createElement('div')
      pulseOverlay.className = 'support-power-ready-pulse'
      pulseOverlay.style.position = 'absolute'
      pulseOverlay.style.top = '2px'
      pulseOverlay.style.right = '2px'
      pulseOverlay.style.width = '8px'
      pulseOverlay.style.height = '8px'
      pulseOverlay.style.borderRadius = '50%'
      pulseOverlay.style.backgroundColor = '#00ff00'
      pulseOverlay.style.boxShadow = '0 0 4px #00ff00'
      container.appendChild(pulseOverlay)
    }

    // ---- Overlay text ----
    const overlayText = this._getOverlayText(power)
    const textEl = document.createElement('div')
    textEl.className = 'support-power-overlay-text'
    textEl.style.position = 'absolute'
    textEl.style.bottom = '2px'
    textEl.style.left = '0'
    textEl.style.width = '100%'
    textEl.style.textAlign = 'center'
    textEl.style.fontSize = '10px'
    textEl.style.fontFamily = 'sans-serif'
    textEl.style.fontWeight = 'bold'
    textEl.style.color = '#ffffff'
    textEl.style.textShadow = '1px 1px 1px #000000'
    textEl.style.pointerEvents = 'none'
    textEl.textContent = overlayText
    container.appendChild(textEl)

    // ---- Hotkey label ----
    if (icon.hotkey) {
      const hotkey = icon.hotkey
      const hotkeyEl = document.createElement('div')
      hotkeyEl.className = 'support-power-hotkey'
      hotkeyEl.style.position = 'absolute'
      hotkeyEl.style.top = '2px'
      hotkeyEl.style.left = '2px'
      hotkeyEl.style.fontSize = '9px'
      hotkeyEl.style.fontFamily = 'sans-serif'
      hotkeyEl.style.color = '#aaa'
      hotkeyEl.style.textShadow = '1px 1px 0 #000'
      hotkeyEl.style.pointerEvents = 'none'
      hotkeyEl.textContent = hotkey.getValue().displayString()
      container.appendChild(hotkeyEl)
    }

    return container
  }

  // ---------------------------------------------------------------------------
  // Event handling
  // OpenRA 对照: SupportPowersWidget.HandleMouseInput / HandleKeyPress
  // ---------------------------------------------------------------------------

  /**
   * Check if a WidgetEvent activates a given HotkeyReference.
   *
   * Matches the ButtonWidget pattern: compare keyName + modifiers directly.
   *
   * @param hotkeyRef — the hotkey reference to check
   * @param event — the widget event
   * @returns true if the event activates this hotkey
   */
  private _isActivatedBy(hotkeyRef: HotkeyReference | null, event: WidgetEvent): boolean {
    if (!hotkeyRef) return false

    const hotkey = hotkeyRef.getValue()
    if (!hotkey.isValid()) return false

    // Compare key name
    const hotkeyKey = keyName(hotkey.key).toLowerCase()
    const eventKey = (event.key ?? '').toLowerCase()
    if (eventKey !== hotkeyKey) return false

    // Compare modifiers
    let eventMods = Modifiers.None
    const ev = event as unknown as { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean }
    if (ev.ctrlKey) eventMods |= Modifiers.Ctrl
    if (ev.altKey) eventMods |= Modifiers.Alt
    if (ev.shiftKey) eventMods |= Modifiers.Shift
    if (ev.metaKey) eventMods |= Modifiers.Meta

    return eventMods === hotkey.modifiers
  }

  /**
   * Handle events: mousemove (tooltip), click (activate), keydown (hotkey).
   *
   * OpenRA 对照: SupportPowersWidget.HandleMouseInput(MouseInput)
   *              + SupportPowersWidget.HandleKeyPress(KeyInput)
   *
   * @param event — widget event
   * @returns true if event was handled
   */
  override handleEvent(event: WidgetEvent): boolean {
    if (!this.spm) return false

    // ---- Keyboard events ----
    if (event.type === 'keydown') {
      for (const icon of this._icons) {
        if (this._isActivatedBy(icon.hotkey, event)) {
          this.clickIcon(icon)
          return true
        }
      }
      return false
    }

    // ---- Mouse events ----
    const posX = (event.clientX ?? 0) as number
    const posY = (event.clientY ?? 0) as number

    if (event.type === 'mousemove') {
      const iconUnderMouse = this._findIconAt(posX, posY)
      this.tooltipIcon = iconUnderMouse
      return false // Don't consume mousemove
    }

    if (event.type === 'mousedown') {
      const iconUnderMouse = this._findIconAt(posX, posY)
      if (iconUnderMouse) {
        // Right-click cancels (no action, just consume)
        if ((event as unknown as { button?: number }).button === 2) {
          return true
        }
        this.clickIcon(iconUnderMouse)
        return true
      }
    }

    return false
  }

  /**
   * Find the icon at the given screen position.
   *
   * @param x — screen X
   * @param y — screen Y
   * @returns the icon at this position, or null
   */
  private _findIconAt(x: number, y: number): SupportPowerIcon | null {
    for (const [icon, rect] of this._iconRects.entries()) {
      if (x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height) {
        return icon
      }
    }
    return null
  }

  // ---------------------------------------------------------------------------
  // Tooltip lifecycle
  // OpenRA 对照: SupportPowersWidget.MouseEntered / MouseExited
  // ---------------------------------------------------------------------------

  /**
   * Show tooltip when mouse enters.
   *
   * OpenRA 对照: SupportPowersWidget.MouseEntered()
   */
  override mouseEntered(): void {
    if (!this.tooltipContainer) return
    // Tooltip is shown on mousemove via handleEvent
  }

  /**
   * Hide tooltip when mouse leaves.
   *
   * OpenRA 对照: SupportPowersWidget.MouseExited()
   */
  override mouseExited(): void {
    if (!this._tooltipContainerDelegate) return
    this._tooltipContainerDelegate.removeTooltip()
    this.tooltipIcon = null
  }

  // ---------------------------------------------------------------------------
  // Set tooltip container delegate
  // ---------------------------------------------------------------------------

  /**
   * Set the tooltip container delegate for showing tooltips.
   *
   * @param delegate — ITooltipContainer implementation
   */
  setTooltipContainer(delegate: ITooltipContainer | null): void {
    this._tooltipContainerDelegate = delegate
  }

  // ---------------------------------------------------------------------------
  // Tick — refresh icons
  // OpenRA 对照: SupportPowersWidget.Tick()
  // ---------------------------------------------------------------------------

  /**
   * Per-frame tick. Refresh icons from SupportPowerManager.
   *
   * OpenRA 对照: SupportPowersWidget.Tick()
   */
  override tick(): void {
    // TODO: Only refresh when powers have changed (optimization)
    this.refreshIcons()
  }

  // ---------------------------------------------------------------------------
  // Event bounds override
  // OpenRA 对照: SupportPowersWidget.EventBounds
  // ---------------------------------------------------------------------------

  /**
   * Get event bounds (union of all icon rectangles).
   *
   * OpenRA 对照: SupportPowersWidget.EventBounds
   */
  get eventBounds(): { x: number; y: number; width: number; height: number } {
    return this._eventBounds
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  /**
   * Dispose widget resources.
   */
  override dispose(): void {
    this.spm = null
    this.sound = null
    this.textNotifications = null
    this.hotkeyResolver = null
    this._tooltipContainerDelegate = null
    this._icons = []
    this._iconRects.clear()
    this._hotkeys = []
    this.onIconCountChanged = null
    this.getTooltipIcon = null
    super.dispose()
  }
}
