/**
 * WidgetUtils.ts — UI widget static utility functions
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/WidgetUtils.cs (428 lines)
 *
 * 核心范式转换:
 * - OpenRA SpriteFont.Measure() → Canvas 2D measureText() (with fallback)
 * - OpenRA Game.Renderer.RgbaSpriteRenderer.DrawSprite → CSS background-image / DOM
 * - OpenRA 9-slice DrawPanel (Sprite[]) → CSS border-image (ChromeProvider.getPanelCss)
 * - OpenRA FillRectWithColor (GPU quad) → CSS background-color (DOM div)
 * - OpenRA FluentProvider.GetMessage → stubbed (pending Fluent migration)
 * - OpenRA C# extension method InflateBy → standalone function
 * - OpenRA Sprite → adapted; Sprite[] panel rendering uses CSS border-image
 * - OpenRA SpriteFont (bitmap font) → CSS font string ("14px Arial")
 */

import { Rectangle } from '../../OpenRA.Game/Primitives/Rectangle.js'
import { CachedTransform } from '../../OpenRA.Game/Primitives/CachedTransform.js'
import { ChromeProvider } from '../../OpenRA.Game/Graphics/ChromeProvider.js'
import { WinState } from '../../OpenRA.Game/Player.js'
import { ClientState } from '../../OpenRA.Game/Network/UnitOrders.js'
import type { Widget } from '../../OpenRA.Game/Widgets/Widget.js'
import type { Color } from './LabelWidget.js'
import type { LabelWithTooltipWidget } from './LabelWithTooltipWidget.js'
import type { ButtonWidget } from './ButtonWidget.js'

// ---------------------------------------------------------------------------
// TextNotification interface (对应 OpenRA TextNotification)
// ---------------------------------------------------------------------------

/** TextNotification pool categories.
 *
 * OpenRA 对照: TextNotificationPool enum
 */
export const TextNotificationPool = {
  System: 'System',
  Join: 'Join',
  Leave: 'Leave',
  Chat: 'Chat',
  Mission: 'Mission',
  Feedback: 'Feedback',
  Transients: 'Transients',
} as const

export type TextNotificationPool = (typeof TextNotificationPool)[keyof typeof TextNotificationPool]

/** Text notification data.
 *
 * OpenRA 对照: TextNotification class
 *
 * NOTE: Full migration of TextNotification class (including Equals/HashCode)
 * deferred. This minimal interface supports WidgetUtils.SetupTextNotification.
 */
export interface TextNotification {
  readonly pool: TextNotificationPool
  readonly prefix: string | null
  readonly clientId: number
  readonly text: string
  readonly prefixColor: Color | null
  readonly textColor: Color | null
  readonly time: { hour: number; minute: number }
}

// ---------------------------------------------------------------------------
// FluentProvider stub
// ---------------------------------------------------------------------------

/** Stub for FluentProvider.GetMessage.
 *
 * OpenRA 对照: FluentProvider.GetMessage(string)
 *
 * NOTE: FluentProvider not yet migrated. Returns the message key directly.
* Integrate with full FluentProvider when migrated.
 */
function fluentGetMessage(key: string): string {
  return key
}

// ---------------------------------------------------------------------------
// Text measurement helper (shared with LabelWidget.ts pattern)
// ---------------------------------------------------------------------------

/** Text measurement cache. Avoids creating excess canvas elements. */
let _measureCanvas: HTMLCanvasElement | null = null
let _measureCtx: CanvasRenderingContext2D | null = null

function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (!_measureCtx) {
    if (typeof document === 'undefined') return null
    if (!_measureCanvas) {
      _measureCanvas = document.createElement('canvas')
    }
    _measureCtx = _measureCanvas.getContext('2d')
  }
  return _measureCtx
}

/** Measure text dimensions using Canvas 2D if available.
 *
 * OpenRA 对照: SpriteFont.Measure(string) → int2
 *
 * @param text — text to measure
 * @param font — CSS font string (e.g. "14px Arial")
 * @returns { width, height } text bounding box
 */
export function measureText(
  text: string,
  font: string,
): { width: number; height: number } {
  const fontSizeMatch = font.match(/(\d+)px/)
  const fontSize = fontSizeMatch ? parseInt(fontSizeMatch[1], 10) : 16
  const lineHeight = fontSize * 1.2

  const ctx = getMeasureCtx()
  if (ctx) {
    ctx.font = font
    const metrics = ctx.measureText(text)
    return { width: metrics.width, height: lineHeight }
  }

  // Fallback when Canvas not available (happy-dom etc.): estimate from char count
  const avgCharWidth = fontSize * 0.6
  return { width: text.length * avgCharWidth, height: lineHeight }
}

// ---------------------------------------------------------------------------
// StatefulImageArgs — input tuple for cached stateful image resolution
// ---------------------------------------------------------------------------

/** Input tuple for cached stateful image resolution. */
export interface StatefulImageArgs {
  disabled: boolean
  pressed: boolean
  hover: boolean
  focused: boolean
  highlighted: boolean
}

// ---------------------------------------------------------------------------
// WidgetUtils — static utility class
// OpenRA 对照: public static class WidgetUtils
// ---------------------------------------------------------------------------

export class WidgetUtils {
  // ---------------------------------------------------------------------------
  // Stateful Image Name
  // OpenRA 对照: WidgetUtils.GetStatefulImageName
  // ---------------------------------------------------------------------------

  /** Append state suffix to a base image name.
   *
   * Priority: disabled > focused > pressed > hover > "".
   *
   * OpenRA 对照: WidgetUtils.GetStatefulImageName(
   *   string, bool disabled, bool pressed, bool hover, bool focused)
   *
   * @param baseName — base image name (e.g. "button")
   * @param disabled — whether the widget is disabled
   * @param pressed — whether the widget is in pressed state
   * @param hover — whether the mouse is hovering
   * @param focused — whether the widget has keyboard focus
   * @returns stateful image name (e.g. "button-disabled")
   */
  static getStatefulImageName(
    baseName: string,
    disabled = false,
    pressed = false,
    hover = false,
    focused = false,
  ): string {
    const suffix = disabled ? '-disabled'
      : focused ? '-focused'
        : pressed ? '-pressed'
          : hover ? '-hover'
            : ''

    return baseName + suffix
  }

  // ---------------------------------------------------------------------------
  // Cached Stateful Image
  // OpenRA 对照: WidgetUtils.GetCachedStatefulImage
  // ---------------------------------------------------------------------------

  /** Get a cached transform that resolves stateful images from ChromeProvider.
   *
   * Returns a CachedTransform that only recomputes when the state tuple changes.
   * Supports highlighted variant (appends "-highlighted" to collection name).
   * Falls back to base image if the stateful variant is not found.
   *
   * OpenRA 对照: WidgetUtils.GetCachedStatefulImage(string, string)
   *
   * @param collection — ChromeProvider collection name
   * @param imageName — base image name
   * @returns CachedTransform mapping state tuple → image URL string
   */
  static getCachedStatefulImage(
    collection: string,
    imageName: string,
  ): CachedTransform<StatefulImageArgs, string> {
    return new CachedTransform<StatefulImageArgs, string>(
      (args: StatefulImageArgs) => {
        const collectionName = collection + (args.highlighted ? '-highlighted' : '')
        // NOTE: In C#, variantImageName is used to look up a specific region
        // within the sprite sheet. In the CSS migration, ChromeProvider returns
        // image URLs directly; region-based lookup is not yet implemented.
        // The variant image name computation is preserved for OpenRA fidelity.
        void WidgetUtils.getStatefulImageName(
          imageName, args.disabled, args.pressed, args.hover, args.focused,
        )
        // NOTE: ChromeProvider in TS returns image URLs (not Sprite objects).
        // TryGetImage semantics: try variant first, fall back to base.
        const resolved = ChromeProvider.getImage(collectionName)
        if (!resolved) {
          // Fall back to base image URL from ChromeProvider
          return ChromeProvider.getImage(collection + (args.highlighted ? '-highlighted' : ''))
        }
        // In the C# version, this returns a Sprite; in TS/CSS version we return
        // the image URL string. The variant image name is used as a region lookup.
        // For simplicity, return the base image URL + variant marker in data attribute.
        return resolved
      },
    )
  }

  // ---------------------------------------------------------------------------
  // Cached Stateful Panel Images
  // OpenRA 对照: WidgetUtils.GetCachedStatefulPanelImages
  // ---------------------------------------------------------------------------

  /** Get a cached transform that resolves stateful panel CSS from ChromeProvider.
   *
   * OpenRA 对照: WidgetUtils.GetCachedStatefulPanelImages(string)
   *
   * @param collection — ChromeProvider collection name
   * @returns CachedTransform mapping state tuple → CSS border-image value string
   */
  static getCachedStatefulPanelImages(
    collection: string,
  ): CachedTransform<StatefulImageArgs, string | null> {
    return new CachedTransform<StatefulImageArgs, string | null>(
      (args: StatefulImageArgs) => {
        const collectionName = collection + (args.highlighted ? '-highlighted' : '')
        const variantCollectionName = WidgetUtils.getStatefulImageName(
          collectionName, args.disabled, args.pressed, args.hover, args.focused,
        )
        // Try variant first, fall back to base
        return ChromeProvider.getPanelCss(variantCollectionName)
          ?? ChromeProvider.getPanelCss(collectionName)
      },
    )
  }

  // ---------------------------------------------------------------------------
  // DrawPanel — 9-slice panel via CSS border-image
  // OpenRA 对照: WidgetUtils.DrawPanel(string, Rectangle)
  // ---------------------------------------------------------------------------

  /** Apply 9-slice panel styling to a DOM element via CSS border-image.
   *
   * This replaces OpenRA's sprite-based 9-slice panel rendering with CSS
   * border-image, which is the modern web equivalent. The element must be
   * a DOM HTMLElement with positioned layout.
   *
   * OpenRA 对照: WidgetUtils.DrawPanel(string, Rectangle)
   *
   * @param collection — ChromeProvider collection name (panel skin key)
   * @param element — DOM element to apply panel styling to
   */
  static drawPanel(collection: string, element: HTMLElement): void {
    const css = ChromeProvider.getPanelCss(collection)
    if (!css) {
      // Fallback: apply solid background for missing panel
      element.style.borderImage = 'none'
      element.style.border = '1px solid rgba(255,255,255,0.3)'
      element.style.backgroundColor = 'rgba(0,0,0,0.7)'
      return
    }

    // CSS format: "image-set(url(...) 1x) 20 50 20 50 fill stretch"
    // Split into source and slice+repeat parts
    const firstParenEnd = css.lastIndexOf(')')
    let source = css
    let sliceAndRepeat = ''
    if (firstParenEnd > 0 && firstParenEnd < css.length - 1) {
      // Need to find the actual URL/image-set end
      const afterSource = css.indexOf(' ', firstParenEnd)
      if (afterSource > 0) {
        source = css.substring(0, afterSource)
        sliceAndRepeat = css.substring(afterSource + 1)
      }
    }

    element.style.borderImageSource = source
    element.style.borderImageSlice = sliceAndRepeat ? sliceAndRepeat.split(' ').slice(0, 4).join(' ') : '0'
    if (sliceAndRepeat.includes('fill')) {
      element.style.borderImageSlice += ' fill'
    }
    element.style.borderImageRepeat = 'stretch'
    element.style.borderImageWidth = 'auto'
    element.style.borderStyle = 'solid'
    element.style.borderWidth = '0px'

    // Ensure minimum panel size
    const minSize = ChromeProvider.getMinimumPanelSize(collection)
    element.style.minWidth = `${minSize.width}px`
    element.style.minHeight = `${minSize.height}px`
  }

  // ---------------------------------------------------------------------------
  // drawPanel(Rectangle, Sprite[]) — legacy 9-slice panel (stub)
  // OpenRA 对照: WidgetUtils.DrawPanel(Rectangle, Sprite[])
  //
  // NOTE: This method uses the OpenRA OpenGL sprite renderer directly.
  // In the TS/CSS migration, 9-slice panels are handled via drawPanel(collection, element)
  // which uses CSS border-image. This method is retained for API compatibility.
  // ---------------------------------------------------------------------------

  /** Apply 9-slice panel styling to a DOM element using Rectangle bounds.
   *
   * OpenRA 对照: WidgetUtils.DrawPanel(Rectangle, Sprite[])
   *
   * NOTE: Adapted for DOM/CSS rendering. The `sprites` parameter is ignored;
   * use drawPanel(collection, element) for CSS-based panel rendering.
   * This overload positions the element at the given bounds.
   *
   * @param bounds — rectangle to fill
   * @param _sprites — nine sprites (ignored in CSS adaptation)
   * @param element — DOM element to position (defaults to a generic div)
   */
  static drawPanelWithBounds(
    bounds: Rectangle,
    _sprites: unknown[],
    element?: HTMLElement,
  ): HTMLElement {
    const el = element ?? document.createElement('div')
    el.style.position = 'absolute'
    el.style.left = `${bounds.Left}px`
    el.style.top = `${bounds.Top}px`
    el.style.width = `${bounds.Width}px`
    el.style.height = `${bounds.Height}px`
    return el
  }

  // ---------------------------------------------------------------------------
  // FormatTime — game tick → "MM:SS" display
  // OpenRA 对照: WidgetUtils.FormatTime(int, int)
  // ---------------------------------------------------------------------------

  /** Convert game ticks to a formatted time string.
   *
   * OpenRA default timestep is 40ms/tick (25 ticks/second).
   *
   * OpenRA 对照: WidgetUtils.FormatTime(int ticks, int timestep)
   *
   * @param ticks — game tick count
   * @param timestep — milliseconds per tick (default 40)
   * @returns formatted time string (e.g. "01:30")
   */
  static formatTime(ticks: number, timestep = 40): string {
    return WidgetUtils.formatTimeWithLeadingZero(ticks, true, timestep)
  }

  /** Convert game ticks to formatted time with optional leading minute zero.
   *
   * OpenRA 对照: WidgetUtils.FormatTime(int ticks, bool leadingMinuteZero, int timestep)
   *
   * @param ticks — game tick count
   * @param leadingMinuteZero — whether to zero-pad minutes
   * @param timestep — ticks per second (default 25)
   * @returns formatted time string
   */
  static formatTimeWithLeadingZero(
    ticks: number,
    leadingMinuteZero: boolean,
    timestep = 40,
  ): string {
    const seconds = Math.ceil(ticks * timestep / 1000)
    return WidgetUtils.formatTimeSeconds(seconds, leadingMinuteZero)
  }

  /** Convert seconds to "MM:SS" or "H:MM:SS" format.
   *
   * OpenRA 对照: WidgetUtils.FormatTimeSeconds(int) + FormatTimeSeconds(int, bool)
   *
   * - If >= 3600 seconds: "H:MM:SS" format
   * - If leadingMinuteZero (default true): "MM:SS" with 2-digit minutes
   * - Otherwise: "M:SS" without minute padding
   *
   * @param seconds — total seconds
   * @param leadingMinuteZero — whether to zero-pad minutes (default true)
   * @returns formatted time string
   */
  static formatTimeSeconds(seconds: number, leadingMinuteZero = true): string {
    // Clamp negative seconds to 0 for graceful display
    if (seconds < 0) seconds = 0
    // Use Math.trunc for C#-compatible integer division (truncates toward zero)
    const minutes = Math.trunc(seconds / 60)
    const remainingSeconds = seconds % 60

    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60)
      const remainingMinutes = minutes % 60
      return `${hours}:${WidgetUtils.pad2(remainingMinutes)}:${WidgetUtils.pad2(remainingSeconds)}`
    }

    if (leadingMinuteZero) {
      return `${WidgetUtils.pad2(minutes)}:${WidgetUtils.pad2(remainingSeconds)}`
    }

    return `${minutes}:${WidgetUtils.pad2(remainingSeconds)}`
  }

  /** Pad a number to 2 digits.
   *
   * @param n — number to pad
   * @returns zero-padded string
   */
  private static pad2(n: number): string {
    return n < 10 ? `0${n}` : `${n}`
  }

  // ---------------------------------------------------------------------------
  // FormatFPS
  // OpenRA 对照: (no direct OpenRA method; common UI helper)
  // ---------------------------------------------------------------------------

  /** Format FPS value with one decimal place.
   *
   * @param fps — frames per second
   * @returns formatted FPS string (e.g. "60.0")
   */
  static formatFPS(fps: number): string {
    return fps.toFixed(1)
  }

  // ---------------------------------------------------------------------------
  // WrapText — word-wrap text to fit within maxWidth
  // OpenRA 对照: WidgetUtils.WrapText(string, int, SpriteFont)
  // ---------------------------------------------------------------------------

  /** Word-wrap text to fit within maxWidth pixels.
   *
   * Uses Canvas 2D measureText() when available, falls back to character-count
   * estimation otherwise.
   *
   * OpenRA 对照: WidgetUtils.WrapText(string text, int width, SpriteFont font)
   *
   * @param text — text to wrap
   * @param maxWidth — maximum line width in pixels
   * @param font — CSS font string (e.g. "14px Arial")
   * @returns wrapped text with newline separators
   */
  static wrapText(text: string, maxWidth: number, font: string): string {
    if (!text || maxWidth <= 0) return text

    const textSize = measureText(text, font)
    if (textSize.width <= maxWidth) return text

    const ctx = getMeasureCtx()

    // Split into lines (existing newlines preserved)
    const paragraphs = text.split('\n')
    const resultLines: string[] = []

    for (const paragraph of paragraphs) {
      if (measureText(paragraph, font).width <= maxWidth) {
        resultLines.push(paragraph)
        continue
      }

      if (ctx) {
        ctx.font = font
        // Scan forward to find the last word that fits
        let start = 0
        while (start < paragraph.length) {
          // Find next space after start
          let spaceIndex = paragraph.indexOf(' ', start)
          let fragmentEnd = spaceIndex === -1 ? paragraph.length : spaceIndex

          // Check if fragment from last break to spaceIndex fits
          while (fragmentEnd > start) {
            const fragment = paragraph.substring(start, fragmentEnd)
            if (ctx.measureText(fragment).width <= maxWidth) break
            // Walk back to previous space
            const prevSpace = paragraph.lastIndexOf(' ', fragmentEnd - 1)
            if (prevSpace <= start) {
              // Single word too long — force break at character
              fragmentEnd = start + 1
              break
            }
            fragmentEnd = prevSpace
          }

          const line = paragraph.substring(start, fragmentEnd).trimEnd()
          resultLines.push(line)
          start = fragmentEnd
          // Skip whitespace at start of next line
          while (start < paragraph.length && paragraph[start] === ' ') start++
        }
      } else {
        // Canvas not available: fallback to character estimation
        const fontSizeMatch = font.match(/(\d+)px/)
        const fontSize = fontSizeMatch ? parseInt(fontSizeMatch[1], 10) : 16
        const avgCharWidth = fontSize * 0.6
        const charsPerLine = Math.max(1, Math.floor(maxWidth / avgCharWidth))
        let remaining = paragraph
        while (remaining.length > 0) {
          let cutIndex = charsPerLine
          if (cutIndex >= remaining.length) {
            resultLines.push(remaining)
            break
          }
          // Try to break at a space
          const spaceIndex = remaining.lastIndexOf(' ', cutIndex)
          if (spaceIndex > 0) {
            resultLines.push(remaining.substring(0, spaceIndex))
            remaining = remaining.substring(spaceIndex + 1)
          } else {
            resultLines.push(remaining.substring(0, cutIndex))
            remaining = remaining.substring(cutIndex)
          }
        }
      }
    }

    return resultLines.join('\n')
  }

  // ---------------------------------------------------------------------------
  // TruncateText — truncate with "..." ellipsis
  // OpenRA 对照: WidgetUtils.TruncateText(string, int, SpriteFont)
  // ---------------------------------------------------------------------------

  /** Truncate text with "..." if it exceeds maxWidth.
   *
   * Uses Canvas 2D measureText() when available.
   * Removes characters from the end and appends "..." until the text fits.
   *
   * OpenRA 对照: WidgetUtils.TruncateText(string text, int width, SpriteFont font)
   *
   * @param text — text to truncate
   * @param maxWidth — maximum width in pixels
   * @param font — CSS font string (e.g. "14px Arial")
   * @returns truncated text (may include "..." suffix)
   */
  static truncateText(text: string, maxWidth: number, font: string): string {
    const trimmedWidth = measureText(text, font).width
    if (trimmedWidth <= maxWidth) return text

    let trimmed = text
    let currentWidth = trimmedWidth

    while (currentWidth > maxWidth && trimmed.length > 3) {
      trimmed = trimmed.substring(0, trimmed.length - 4) + '...'
      currentWidth = measureText(trimmed, font).width
    }

    return trimmed
  }

  // ---------------------------------------------------------------------------
  // TruncateLabelToTooltip
  // OpenRA 对照: WidgetUtils.TruncateLabelToTooltip(LabelWithTooltipWidget, string)
  // ---------------------------------------------------------------------------

  /** Truncate label text and show full text in tooltip.
   *
   * OpenRA 对照: WidgetUtils.TruncateLabelToTooltip(LabelWithTooltipWidget, string)
   *
   * @param label — the label widget
   * @param text — full text to display
   */
  static truncateLabelToTooltip(
    label: LabelWithTooltipWidget,
    text: string,
  ): void {
    const truncatedText = WidgetUtils.truncateText(
      text,
      label.bounds.width,
      label.font,
    )

    label.getText = () => truncatedText

    if (text !== truncatedText) {
      label.getTooltipText = () => text
    } else {
      label.getTooltipText = () => ''
    }
  }

  // ---------------------------------------------------------------------------
  // TruncateButtonToTooltip
  // OpenRA 对照: WidgetUtils.TruncateButtonToTooltip(ButtonWidget, string)
  // ---------------------------------------------------------------------------

  /** Truncate button text and show full text in tooltip.
   *
   * OpenRA 对照: WidgetUtils.TruncateButtonToTooltip(ButtonWidget, string)
   *
   * @param button — the button widget
   * @param text — full text to display
   */
  static truncateButtonToTooltip(
    button: ButtonWidget,
    text: string,
  ): void {
    const truncatedText = WidgetUtils.truncateText(
      text,
      button.bounds.width - button.leftMargin - button.rightMargin,
      button.font,
    )

    button.getText = () => truncatedText

    if (text !== truncatedText) {
      button.getTooltipText = () => text
    } else {
      button.getTooltipText = null
    }
  }

  // ---------------------------------------------------------------------------
  // BindButtonIcon
  // OpenRA 对照: WidgetUtils.BindButtonIcon(ButtonWidget)
  // ---------------------------------------------------------------------------

  /** Bind a stateful icon to a button's child ImageWidget.
   *
   * OpenRA 对照: WidgetUtils.BindButtonIcon(ButtonWidget)
   *
   * @param button — the button widget with an "ICON" child
   */
  static bindButtonIcon(button: ButtonWidget): void {
    // NOTE: In OpenRA, this calls button.Get<ImageWidget>("ICON").
    // In TypeScript, we use the Widget base class getOrNull which walks children.
    // HACK: getOrNull expects T extends Widget, but we only need a minimal
    // interface from ImageWidget. Cast through unknown to bypass constraint.
    const icon = (button.getOrNull as (id: string) => unknown)('ICON') as
      { imageCollection: string; imageName: string; getSprite: () => string } | null
    if (!icon) return

    // NOTE: The TS ImageWidget uses imageName/imageCollection similar to OpenRA.
    // We adapt by creating a CachedTransform that resolves via ChromeProvider.
    const cache = WidgetUtils.getCachedStatefulImage(
      icon.imageCollection,
      icon.imageName,
    )

    // Bind the icon's getSprite to update from the cached transform
    icon.getSprite = () => cache.update({
      disabled: button.isDisabled(),
      pressed: button.depressed,
      hover: false, // NOTE: Ui.MouseOverWidget not available; approximate via button state
      focused: false,
      highlighted: button.isHighlighted(),
    })
  }

  // ---------------------------------------------------------------------------
  // WithSuffix — append win/loss/disconnected suffix to player name
  // OpenRA 对照: WidgetUtils.WithSuffix(string, WinState, Session.ClientState)
  // ---------------------------------------------------------------------------

  /** Append a status suffix to a player name.
   *
   * OpenRA 对照: WidgetUtils.WithSuffix(string name, WinState, Session.ClientState)
   *
   * @param name — base player name
   * @param winState — win/loss state
   * @param clientState — connection state
   * @returns name with status suffix
   */
  static withSuffix(
    name: string,
    winState: number,
    clientState: number,
  ): string {
    // OpenRA Fluent keys:
    //   "label-client-state-disconnected" = "Gone"
    //   "label-win-state-won" = "Won"
    //   "label-win-state-lost" = "Lost"
    if (clientState === ClientState.Disconnected) {
      return `${name} (${fluentGetMessage('label-client-state-disconnected')})`
    }

    if (winState === WinState.Won) {
      return `${name} (${fluentGetMessage('label-win-state-won')})`
    }

    if (winState === WinState.Lost) {
      return `${name} (${fluentGetMessage('label-win-state-lost')})`
    }

    return name
  }

  // ---------------------------------------------------------------------------
  // BindPlayerNameAndStatus
  // OpenRA 对照: WidgetUtils.BindPlayerNameAndStatus(LabelWithTooltipWidget, Player)
  // ---------------------------------------------------------------------------

  /** Bind a player's name and status to a label widget.
   *
   * OpenRA 对照: WidgetUtils.BindPlayerNameAndStatus(LabelWithTooltipWidget, Player)
   *
   * @param label — the label widget
   * @param player — player object with winState, clientIndex, resolvedPlayerName
   */
  static bindPlayerNameAndStatus(
    label: LabelWithTooltipWidget,
    player: {
      resolvedPlayerName: string
      winState: number
      clientIndex: number
      world?: { lobbyInfo?: { clientWithIndex(idx: number): { state: number } | null } }
    },
  ): void {
    const nameCache = new CachedTransform<
      { winState: number; clientState: number },
      string
    >((c) => {
      const text = WidgetUtils.withSuffix(
        player.resolvedPlayerName,
        c.winState,
        c.clientState,
      )
      const truncatedText = WidgetUtils.truncateText(
        text,
        label.bounds.width,
        label.font,
      )

      if (text !== truncatedText) {
        label.getTooltipText = () => text
      } else {
        label.getTooltipText = () => ''
      }

      return truncatedText
    })

    label.getText = () => {
      const client = player.world?.lobbyInfo?.clientWithIndex(player.clientIndex)
      const clientState = client != null ? client.state : ClientState.Ready
      return nameCache.update({ winState: player.winState, clientState })
    }

    // Trigger initial tooltip update
    label.getText()
  }

  // ---------------------------------------------------------------------------
  // SetupTextNotification
  // OpenRA 对照: WidgetUtils.SetupTextNotification
  // ---------------------------------------------------------------------------

  /** Configure a notification widget with text, prefix, timestamp.
   *
   * OpenRA 对照: WidgetUtils.SetupTextNotification(
   *   Widget, TextNotification, int boxWidth, bool withTimestamp)
   *
   * @param notificationWidget — the notification container widget
   * @param notification — text notification data
   * @param boxWidth — total container width in pixels
   * @param withTimestamp — whether to show timestamp
   */
  static setupTextNotification(
    notificationWidget: {
      bounds: { X: number; Y: number; Width: number; Height: number }
      getOrNull: <T>(id: string) => T | null
      get: <T>(id: string) => T
    },
    notification: TextNotification,
    boxWidth: number,
    withTimestamp: boolean,
  ): void {
    const timeLabel = notificationWidget.getOrNull<{
      bounds: { X: number; Y: number; Width: number; Height: number }
      font: string
      getText: (() => string) | null
      setText?: (t: string) => void
    }>('TIME')

    const prefixLabel = notificationWidget.getOrNull<{
      bounds: { X: number; Y: number; Width: number; Height: number }
      font: string
      getText: (() => string) | null
      getColor: (() => string) | null
      textColor: string
    }>('PREFIX')

    const textLabel = notificationWidget.get<{
      bounds: { X: number; Y: number; Width: number; Height: number }
      font: string
      getText: (() => string) | null
      getColor: (() => string) | null
      textColor: string
    }>('TEXT')

    const textFont = textLabel.font
    let textWidth = boxWidth - notificationWidget.bounds.X - textLabel.bounds.X

    const hasPrefix = notification.prefix != null
      && notification.prefix.length > 0
      && prefixLabel != null
    let timeOffset = 0

    if (withTimestamp && timeLabel != null) {
      const time = `${WidgetUtils.pad2(notification.time.hour)}:${WidgetUtils.pad2(notification.time.minute)}`
      timeOffset = timeLabel.bounds.Width + timeLabel.bounds.X

      timeLabel.getText = () => time

      textWidth -= timeOffset
      textLabel.bounds.X += timeOffset

      if (hasPrefix) {
        prefixLabel.bounds.X += timeOffset
      }
    }

    if (hasPrefix && prefixLabel != null) {
      const prefix = notification.prefix! + ':'
      const prefixSize = measureText(prefix, prefixLabel.font)
      const prefixOffset = prefixSize.width + prefixLabel.bounds.X

      prefixLabel.getColor = () => notification.prefixColor ?? prefixLabel.textColor
      prefixLabel.getText = () => prefix
      prefixLabel.bounds.Width = prefixSize.width

      textWidth -= prefixOffset
      textLabel.bounds.X += prefixOffset - timeOffset
    }

    textLabel.getColor = () => notification.textColor ?? textLabel.textColor
    textLabel.bounds.Width = textWidth

    // Wrap text to fit
    const text = WidgetUtils.wrapText(notification.text, textLabel.bounds.Width, textFont)
    textLabel.getText = () => text
    const textHeight = measureText(text, textFont).height
    const dh = textHeight - textLabel.bounds.Height
    if (dh > 0) {
      textLabel.bounds.Height += dh
      notificationWidget.bounds.Height += dh
    }

    notificationWidget.bounds.Width = boxWidth - notificationWidget.bounds.X
  }

  // ---------------------------------------------------------------------------
  // InflateBy — extension method on Rectangle
  // OpenRA 对照: WidgetUtils.InflateBy(this Rectangle, int, int, int, int)
  // ---------------------------------------------------------------------------

  /** Inflate a rectangle by the given margins.
   *
   * Positive values expand outward; negative values shrink inward.
   *
   * OpenRA 对照: Rectangle.InflateBy(this Rectangle rect, int l, int t, int r, int b)
   *
   * @param rect — source rectangle
   * @param l — left inflation
   * @param t — top inflation
   * @param r — right inflation
   * @param b — bottom inflation
   * @returns new inflated Rectangle
   */
  static inflateBy(
    rect: Rectangle,
    l: number,
    t: number,
    r: number,
    b: number,
  ): Rectangle {
    return Rectangle.fromLTRB(
      rect.Left - l,
      rect.Top - t,
      rect.Right + r,
      rect.Bottom + b,
    )
  }

  // ---------------------------------------------------------------------------
  // GetTextContrastColor — return white or black based on background luminance
  // ---------------------------------------------------------------------------

  /** Get contrasting text color (white or black) for a given background color.
   *
   * Returns white (#FFFFFF) for dark backgrounds and black (#000000) for light.
   * Formula: relative luminance < 128 → white, else black.
   *
   * @param textColor — the background color to contrast against
   * @returns contrast color as CSS hex string
   */
  static getTextContrastColor(textColor: Color): Color {
    const rgb = WidgetUtils._parseHexColor(textColor)
    if (!rgb) return '#FFFFFF'

    // Relative luminance formula (ITU-R BT.601)
    // Using standard weights: R*0.299 + G*0.587 + B*0.114
    // Round to avoid floating-point edge cases (e.g. #808080 → exactly 128)
    const luminance = Math.round(
      rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114,
    )

    return luminance < 128 ? '#FFFFFF' : '#000000'
  }

  /** Parse a hex color string into { r, g, b } components.
   *
   * Supports formats: "#RGB", "#RRGGBB", "#RRGGBBAA"
   *
   * @param color — CSS color string
   * @returns RGB components or null if unparseable
   */
  private static _parseHexColor(
    color: string,
  ): { r: number; g: number; b: number } | null {
    if (!color || !color.startsWith('#')) return null

    const hex = color.substring(1)
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
      }
    }
    if (hex.length >= 6) {
      return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16),
      }
    }
    return null
  }

  // ---------------------------------------------------------------------------
  // FillRectWithColor — CSS background-color fill
  // OpenRA 对照: WidgetUtils.FillRectWithColor(Rectangle, Color)
  // ---------------------------------------------------------------------------

  /** Apply solid color fill to a DOM element.
   *
   * OpenRA 对照: WidgetUtils.FillRectWithColor(Rectangle, Color)
   *
   * @param element — DOM element to style
   * @param color — CSS color string
   */
  static fillRectWithColor(element: HTMLElement, color: Color): void {
    element.style.backgroundColor = color
  }

  /** Apply gradient color fill to a DOM element.
   *
   * OpenRA 对照: WidgetUtils.FillRectWithColor(
   *   Rectangle, Color tl, Color tr, Color br, Color bl)
   *
   * @param element — DOM element to style
   * @param topLeftColor — top-left corner color
   * @param topRightColor — top-right corner color
   * @param bottomRightColor — bottom-right corner color
   * @param bottomLeftColor — bottom-left corner color
   */
  static fillRectWithGradient(
    element: HTMLElement,
    topLeftColor: Color,
    _topRightColor: Color,
    bottomRightColor: Color,
    _bottomLeftColor: Color,
  ): void {
    // NOTE: CSS linear-gradient cannot do per-corner colors like OpenRA's
    // quad-based GPU fill. Currently uses a diagonal linear gradient as
    // approximation. The _topRightColor and _bottomLeftColor parameters are
    // preserved for API compatibility but not used in the CSS fallback.
    // A full per-corner gradient would require canvas 2D rendering.
    element.style.background = ''
    element.style.backgroundColor = ''
    element.style.background = `linear-gradient(135deg, ${topLeftColor}, ${bottomRightColor})`
  }

  // ---------------------------------------------------------------------------
  // FillEllipseWithColor — CSS border-radius ellipse
  // OpenRA 对照: WidgetUtils.FillEllipseWithColor(Rectangle, Color)
  // ---------------------------------------------------------------------------

  /** Apply elliptical fill to a DOM element via CSS border-radius.
   *
   * OpenRA 对照: WidgetUtils.FillEllipseWithColor(Rectangle, Color)
   *
   * @param element — DOM element to style (should have size set)
   * @param color — CSS color string
   */
  static fillEllipseWithColor(element: HTMLElement, color: Color): void {
    element.style.backgroundColor = color
    element.style.borderRadius = '50%'
    element.style.overflow = 'hidden'
  }

  // ---------------------------------------------------------------------------
  // FillRectWithSprite — tile a sprite image within a rectangle
  // OpenRA 对照: WidgetUtils.FillRectWithSprite(Rectangle, Sprite)
  //
  // NOTE: Adapted for CSS. Uses background-image repeat for tiling.
  // ---------------------------------------------------------------------------

  /** Tile a sprite image within a DOM element.
   *
   * OpenRA 对照: WidgetUtils.FillRectWithSprite(Rectangle, Sprite)
   *
   * @param element — DOM element to style
   * @param imageUrl — the sprite image URL to tile
   * @param _bounds — the sub-region of the sprite to tile (ignored in CSS version)
   */
  static fillRectWithSprite(
    element: HTMLElement,
    imageUrl: string,
    _bounds?: { x: number; y: number; width: number; height: number },
  ): void {
    element.style.backgroundImage = `url("${imageUrl}")`
    element.style.backgroundRepeat = 'repeat'
    element.style.backgroundSize = 'auto'
  }

  // ---------------------------------------------------------------------------
  // DrawSprite — DOM image rendering
  // OpenRA 对照: WidgetUtils.DrawSprite(Sprite, float2) / DrawSprite(Sprite, float2, Size)
  //
  // NOTE: Original methods use OpenRA's GPU sprite renderer (RgbaSpriteRenderer).
  // In the TS/DOM adaptation, sprites are rendered as CSS background-image on
  // positioned DOM elements with appropriate background-position and background-size.
  // ---------------------------------------------------------------------------

  /** Render a sprite image at the specified position via CSS.
   *
   * OpenRA 对照: WidgetUtils.DrawSprite(Sprite s, float2 pos)
   *
   * @param element — DOM element to style
   * @param imageUrl — sprite image URL
   * @param spriteWidth — sprite width in pixels
   * @param spriteHeight — sprite height in pixels
   * @param x — X position in pixels
   * @param y — Y position in pixels
   * @param uvX — sub-region X offset within image (default 0)
   * @param uvY — sub-region Y offset within image (default 0)
   */
  static drawSprite(
    element: HTMLElement,
    imageUrl: string,
    spriteWidth: number,
    spriteHeight: number,
    x: number,
    y: number,
    uvX = 0,
    uvY = 0,
  ): void {
    element.style.position = 'absolute'
    element.style.left = `${x}px`
    element.style.top = `${y}px`
    element.style.width = `${spriteWidth}px`
    element.style.height = `${spriteHeight}px`
    element.style.backgroundImage = `url("${imageUrl}")`
    element.style.backgroundPosition = `-${uvX}px -${uvY}px`
    element.style.backgroundSize = 'auto'
    element.style.backgroundRepeat = 'no-repeat'
  }

  /** Render a scaled sprite image at the specified position via CSS.
   *
   * OpenRA 对照: WidgetUtils.DrawSprite(Sprite s, float2 pos, Size size)
   *
   * @param element — DOM element to style
   * @param imageUrl — sprite image URL
   * @param spriteWidth — original sprite width in pixels
   * @param spriteHeight — original sprite height in pixels
   * @param x — X position in pixels
   * @param y — Y position in pixels
   * @param targetWidth — target display width
   * @param targetHeight — target display height
   */
  static drawSpriteScaled(
    element: HTMLElement,
    imageUrl: string,
    spriteWidth: number,
    spriteHeight: number,
    x: number,
    y: number,
    targetWidth: number,
    targetHeight: number,
  ): void {
    const scaleX = targetWidth / spriteWidth
    const scaleY = targetHeight / spriteHeight

    element.style.position = 'absolute'
    element.style.left = `${x}px`
    element.style.top = `${y}px`
    element.style.width = `${targetWidth}px`
    element.style.height = `${targetHeight}px`
    element.style.backgroundImage = `url("${imageUrl}")`
    element.style.backgroundSize = `${spriteWidth * scaleX}px ${spriteHeight * scaleY}px`
    element.style.backgroundPosition = '0 0'
    element.style.backgroundRepeat = 'no-repeat'
  }

  /** Render a centered sprite at the specified position via CSS.
   *
   * OpenRA 对照: WidgetUtils.DrawSpriteCentered(Sprite s, PaletteReference p, float2 pos, float scale)
   *
   * @param element — DOM element to style
   * @param imageUrl — sprite image URL
   * @param spriteWidth — sprite width in pixels
   * @param spriteHeight — sprite height in pixels
   * @param centerX — center X position in pixels
   * @param centerY — center Y position in pixels
   * @param scale — scale factor (default 1)
   */
  static drawSpriteCentered(
    element: HTMLElement,
    imageUrl: string,
    spriteWidth: number,
    spriteHeight: number,
    centerX: number,
    centerY: number,
    scale = 1,
  ): void {
    const scaledW = spriteWidth * scale
    const scaledH = spriteHeight * scale
    const left = centerX - 0.5 * scaledW
    const top = centerY - 0.5 * scaledH

    element.style.position = 'absolute'
    element.style.left = `${left}px`
    element.style.top = `${top}px`
    element.style.width = `${scaledW}px`
    element.style.height = `${scaledH}px`
    element.style.backgroundImage = `url("${imageUrl}")`
    element.style.backgroundSize = `${scaledW}px ${scaledH}px`
    element.style.backgroundPosition = 'center'
    element.style.backgroundRepeat = 'no-repeat'
  }

  // ---------------------------------------------------------------------------
  // getChildWidget — consolidated typed child widget access
  // Replaces wc()/widgetChild()/asDyn() in Lobby and Browser files.
  // OpenRA 对照: widget.Get<T>(id) via YAML-bound widget tree
  //
  // NOTE: Uses direct property access (like OpenRA's widget tree) rather
  // than recursive tree search, since child widgets are stored as direct
  // properties on parent by the YAML widget loader.
  // ---------------------------------------------------------------------------

  /** Get a child widget by ID with typed access.
   *
   * Preferred usage: `Widget.getOrNull<T>(id)` for recursive tree search.
   * Use this only when the widget tree uses direct property binding.
   *
   * @param parent — parent widget
   * @param id — child widget ID
   * @returns typed widget or undefined
   */
  static getChildWidget<T extends Widget = Widget>(
    parent: Widget,
    id: string,
  ): T | undefined {
    return (parent as unknown as Record<string, unknown>)[id] as T | undefined
  }

  /** Dynamic property accessor for widget duck-typing.
   *
   * Consolidates the asDyn() pattern from Browser files into a single utility.
   * Prefer typed widget access via get<T>() / getOrNull<T>() when possible.
   *
   * @param w — widget to access dynamically
   * @returns the same widget cast to Record<string, unknown> & Widget
   */
  static asDyn(w: Widget): Record<string, unknown> & Widget {
    return w as unknown as Record<string, unknown> & Widget
  }
}
