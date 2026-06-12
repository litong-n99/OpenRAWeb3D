/**
 * ViewportControllerWidget.ts — 视口控制 Widget: 热键绑定、边缘滚动、鼠标缩放、光标切换
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/ViewportControllerWidget.cs (506 lines)
 *
 * 核心范式转换:
 * - C# HotkeyReference + Hotkey.IsActivatedBy() → TS 简化热键接口 (KeyCode 匹配)
 * - C# SDL2 鼠标事件轮询 → TS 浏览器事件驱动的 Widget 框架
 * - C# Game.Settings.Game.ViewportEdgeScroll → TS IViewportSettings 接口
 * - C# ScrollDirection + ScrollOffsets → TS 相同位标志 + 方向偏移表
 * - C# ImmutableArray<(Direction, Cursor)> → TS const readonly 数组
 * - C# Game.RunTime → performance.now() 浏览器高精度时间
 * - C# WorldTooltipType + ITooltip → TODO trait 系统迁移后实现
 */

import {
  Widget,
  Ui,
  type WidgetArgs,
} from '../../OpenRA.Game/Widgets/Widget'

import {
  ScrollDirection,
  ScrollDirectionExts,
  Viewport,
} from '../../OpenRA.Game/Graphics/Viewport'

import {
  MouseInputEvent,
  MouseButton,
  KeyInputEvent,
  Modifiers,
  type MouseInput,
  type KeyInput,
} from '../../OpenRA.Game/Input/IInputHandler'

import type { KeyCode } from '../../OpenRA.Game/Input/Keycode'

// ---------------------------------------------------------------------------
// MouseScrollType 枚举 (对应 OpenRA MouseScrollType)
// ---------------------------------------------------------------------------

/** 鼠标滚动类型。OpenRA 对照: MouseScrollType enum */
export const MouseScrollType = {
  Disabled: 0,
  Standard: 1,
  Inverted: 2,
  Joystick: 3,
} as const
export type MouseScrollType = (typeof MouseScrollType)[keyof typeof MouseScrollType]

// ---------------------------------------------------------------------------
// MouseControlStyle 枚举 (对应 OpenRA MouseControlStyle)
// ---------------------------------------------------------------------------

/** 鼠标控制风格。OpenRA 对照: MouseControlStyle enum { Classic, Modern } */
export const MouseControlStyle = {
  Classic: 0,
  Modern: 1,
} as const
export type MouseControlStyle = (typeof MouseControlStyle)[keyof typeof MouseControlStyle]

// ---------------------------------------------------------------------------
// WorldTooltipType 枚举 (对应 OpenRA WorldTooltipType)
// ---------------------------------------------------------------------------

/** 世界工具提示类型。OpenRA 对照: enum WorldTooltipType */
export const WorldTooltipType = {
  None: 0,
  Unexplored: 1,
  Actor: 2,
  FrozenActor: 3,
  Resource: 4,
} as const
export type WorldTooltipType = (typeof WorldTooltipType)[keyof typeof WorldTooltipType]

// ---------------------------------------------------------------------------
// IHotkeyReference — 热键引用最小接口
// ---------------------------------------------------------------------------

/**
 * 热键引用接口 (简化版，完整实现等待 HotkeyManager 迁移)。
 *
 * OpenRA 对照: HotkeyReference class
 *
 * TODO-7.B.2.1: HotkeyManager 迁移后替换为完整实现。
 */
export interface IHotkeyReference {
  /** 获取热键的键位值 */
  getValue(): { key: KeyCode; modifiers: number }
  /** 检查给定输入是否激活此热键 */
  isActivatedBy(input: KeyInput): boolean
}

// ---------------------------------------------------------------------------
// IViewportSettings — 视口设置最小接口
// ---------------------------------------------------------------------------

/**
 * 视口设置接口 (简化版)。
 *
 * OpenRA 对照: GameSettings.Game 的子集
 *
 * TODO-7.B.2.2: Settings 系统迁移后替换为完整 GameSettings。
 */
export interface IViewportSettings {
  viewportEdgeScroll: boolean
  viewportEdgeScrollMargin: number
  viewportEdgeScrollStep: number
  mouseScroll: MouseScrollType
  mouseScrollDeadzone: number
  mouseControlStyle: MouseControlStyle
  useAlternateScrollButton: boolean
  zoomModifier: number
  zoomSpeed: number
}

/** 默认视口设置 (匹配 OpenRA 默认值)。 */
export const DEFAULT_VIEWPORT_SETTINGS: IViewportSettings = {
  viewportEdgeScroll: true,
  viewportEdgeScrollMargin: 15,
  viewportEdgeScrollStep: 30,
  mouseScroll: MouseScrollType.Standard,
  mouseScrollDeadzone: 5,
  mouseControlStyle: MouseControlStyle.Classic,
  useAlternateScrollButton: false,
  zoomModifier: Modifiers.Ctrl,
  zoomSpeed: 0.05,
}

// ---------------------------------------------------------------------------
// (ScrollDirection, cursorName) 映射表
// ---------------------------------------------------------------------------

interface DirectionCursor {
  direction: ScrollDirection
  cursor: string
}

/** 边缘滚动方向 → 光标名称。OpenRA 对照: ScrollCursors */
const SCROLL_CURSORS: readonly DirectionCursor[] = [
  { direction: ScrollDirection.Up | ScrollDirection.Left, cursor: 'scroll-tl' },
  { direction: ScrollDirection.Up | ScrollDirection.Right, cursor: 'scroll-tr' },
  { direction: ScrollDirection.Down | ScrollDirection.Left, cursor: 'scroll-bl' },
  { direction: ScrollDirection.Down | ScrollDirection.Right, cursor: 'scroll-br' },
  { direction: ScrollDirection.Up, cursor: 'scroll-t' },
  { direction: ScrollDirection.Down, cursor: 'scroll-b' },
  { direction: ScrollDirection.Left, cursor: 'scroll-l' },
  { direction: ScrollDirection.Right, cursor: 'scroll-r' },
]

/** Joystick 滚动方向 → 光标名称。OpenRA 对照: JoystickCursors */
const JOYSTICK_CURSORS: readonly DirectionCursor[] = [
  { direction: ScrollDirection.Up | ScrollDirection.Left, cursor: 'joystick-tl-blocked' },
  { direction: ScrollDirection.Up | ScrollDirection.Right, cursor: 'joystick-tr-blocked' },
  { direction: ScrollDirection.Down | ScrollDirection.Left, cursor: 'joystick-bl-blocked' },
  { direction: ScrollDirection.Down | ScrollDirection.Right, cursor: 'joystick-br-blocked' },
  { direction: ScrollDirection.Up, cursor: 'joystick-t-blocked' },
  { direction: ScrollDirection.Down, cursor: 'joystick-b-blocked' },
  { direction: ScrollDirection.Left, cursor: 'joystick-l-blocked' },
  { direction: ScrollDirection.Right, cursor: 'joystick-r-blocked' },
]

// ---------------------------------------------------------------------------
// 滚动方向 → 世界偏移量映射表 (对应 OpenRA ScrollOffsets)
// ---------------------------------------------------------------------------

interface DirectionOffset {
  direction: ScrollDirection
  offset: { x: number; y: number }
}

const SCROLL_OFFSETS: readonly DirectionOffset[] = [
  { direction: ScrollDirection.Up, offset: { x: 0, y: -1 } },
  { direction: ScrollDirection.Down, offset: { x: 0, y: 1 } },
  { direction: ScrollDirection.Left, offset: { x: -1, y: 0 } },
  { direction: ScrollDirection.Right, offset: { x: 1, y: 0 } },
]

// ---------------------------------------------------------------------------
// ViewportControllerWidget
// ---------------------------------------------------------------------------

/**
 * 视口控制 Widget：处理所有与相机/视口相关的用户输入。
 *
 * OpenRA 对照: class ViewportControllerWidget : Widget
 *
 * 职责:
 * 1. 键盘滚屏 (方向键)
 * 2. 边缘滚屏 (鼠标靠近窗口边缘)
 * 3. 鼠标拖拽滚屏 (Standard/Inverted/Joystick)
 * 4. 鼠标滚轮缩放 (ZoomModifier 检测)
 * 5. 跳转到地图边缘
 * 6. 书签保存/恢复
 * 7. 光标切换
 * 8. 工具提示类型管理
 *
 * 输入路由: ViewportControllerWidget 处理相机移动，
 * WorldInteractionControllerWidget (Ch5) 处理单位选择。
 */
export class ViewportControllerWidget extends Widget {
  // ---------------------------------------------------------------------------
  // 公共热键配置
  // ---------------------------------------------------------------------------

  zoomInKey: IHotkeyReference
  zoomOutKey: IHotkeyReference
  scrollUpKey: IHotkeyReference
  scrollDownKey: IHotkeyReference
  scrollLeftKey: IHotkeyReference
  scrollRightKey: IHotkeyReference
  jumpToTopEdgeKey: IHotkeyReference
  jumpToBottomEdgeKey: IHotkeyReference
  jumpToLeftEdgeKey: IHotkeyReference
  jumpToRightEdgeKey: IHotkeyReference

  bookmarkSaveKeyPrefix: string | null = null
  bookmarkRestoreKeyPrefix: string | null = null
  bookmarkKeyCount: number = 0
  tooltipTemplate: string = 'WORLD_TOOLTIP'
  tooltipContainer: string = ''

  // ---------------------------------------------------------------------------
  // 内部状态
  // ---------------------------------------------------------------------------

  readonly viewport: Viewport
  readonly settings: IViewportSettings

  private joystickScrollStart: { x: number; y: number } | null = null
  private joystickScrollEnd: { x: number; y: number } | null = null
  private standardScrollStart: { x: number; y: number } | null = null
  private isStandardScrolling: boolean = false
  private keyboardDirections: ScrollDirection = ScrollDirection.None
  private edgeDirections: ScrollDirection = ScrollDirection.None
  private lastScrollTime: number = 0
  private saveBookmarkHotkeys: IHotkeyReference[] = []
  private restoreBookmarkHotkeys: IHotkeyReference[] = []
  private bookmarkPositions: ({ x: number; y: number; z: number } | null)[] = []
  private viewportTickRegistered: boolean = false

  /** 工具提示类型 */
  tooltipType: WorldTooltipType = WorldTooltipType.None
  /** Actor 工具提示 (TODO: trait 系统迁移后实现) */
  actorTooltip: unknown = null
  actorTooltipExtra: unknown[] | null = null
  frozenActorTooltip: unknown = null
  resourceTooltip: string | null = null

  // ---------------------------------------------------------------------------
  // 构造
  // ---------------------------------------------------------------------------

  /**
   * 创建 ViewportControllerWidget。
   *
   * OpenRA 对照: ViewportControllerWidget(ModData modData, World world, WorldRenderer worldRenderer)
   */
  constructor(
    viewport: Viewport,
    settings?: Partial<IViewportSettings>,
    zoomInKey?: IHotkeyReference,
    zoomOutKey?: IHotkeyReference,
    scrollUpKey?: IHotkeyReference,
    scrollDownKey?: IHotkeyReference,
    scrollLeftKey?: IHotkeyReference,
    scrollRightKey?: IHotkeyReference,
    jumpToTopEdgeKey?: IHotkeyReference,
    jumpToBottomEdgeKey?: IHotkeyReference,
    jumpToLeftEdgeKey?: IHotkeyReference,
    jumpToRightEdgeKey?: IHotkeyReference,
  ) {
    super()

    this.viewport = viewport
    this.settings = { ...DEFAULT_VIEWPORT_SETTINGS, ...settings }

    this.zoomInKey = zoomInKey ?? this.createDummyHotkey()
    this.zoomOutKey = zoomOutKey ?? this.createDummyHotkey()
    this.scrollUpKey = scrollUpKey ?? this.createDummyHotkey()
    this.scrollDownKey = scrollDownKey ?? this.createDummyHotkey()
    this.scrollLeftKey = scrollLeftKey ?? this.createDummyHotkey()
    this.scrollRightKey = scrollRightKey ?? this.createDummyHotkey()
    this.jumpToTopEdgeKey = jumpToTopEdgeKey ?? this.createDummyHotkey()
    this.jumpToBottomEdgeKey = jumpToBottomEdgeKey ?? this.createDummyHotkey()
    this.jumpToLeftEdgeKey = jumpToLeftEdgeKey ?? this.createDummyHotkey()
    this.jumpToRightEdgeKey = jumpToRightEdgeKey ?? this.createDummyHotkey()

    this.viewport.onViewportTick(this.updateCameraTick)
    this.viewportTickRegistered = true
  }

  // ---------------------------------------------------------------------------
  // Widget.render() — 抽象方法实现
  // ---------------------------------------------------------------------------

  /**
   * 返回此 Widget 的 DOM 元素。
   *
   * ViewportControllerWidget 是全屏透明覆盖层，捕获输入但不渲染可见内容。
   *
   * @returns 全屏覆盖 div 元素
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'viewport-controller-widget')
    el.style.position = 'absolute'
    el.style.left = '0'
    el.style.top = '0'
    el.style.width = '100%'
    el.style.height = '100%'
    // 光标样式由 getCursor() 返回
    el.style.cursor = 'inherit'
    if (this.id) {
      el.setAttribute('data-widget-id', this.id)
    }
    return el
  }

  // ---------------------------------------------------------------------------
  // 占位热键 (TODO: HotkeyManager 迁移后移除)
  // ---------------------------------------------------------------------------

  private createDummyHotkey(): IHotkeyReference {
    return {
      getValue: () => ({ key: 0 as KeyCode, modifiers: 0 }),
      isActivatedBy: () => false,
    }
  }

  // ---------------------------------------------------------------------------
  // Widget 生命周期
  // ---------------------------------------------------------------------------

  override initialize(args: WidgetArgs): void {
    super.initialize(args)

    if (this.bookmarkKeyCount > 0) {
      this.saveBookmarkHotkeys = this.createBookmarkHotkeys(
        this.bookmarkSaveKeyPrefix,
        this.bookmarkKeyCount,
      )
      this.restoreBookmarkHotkeys = this.createBookmarkHotkeys(
        this.bookmarkRestoreKeyPrefix,
        this.bookmarkKeyCount,
      )
      this.bookmarkPositions = new Array(this.bookmarkKeyCount).fill(null)
    }
  }

  private createBookmarkHotkeys(
    prefix: string | null,
    count: number,
  ): IHotkeyReference[] {
    if (!prefix) return []
    return Array.from({ length: count }, () => this.createDummyHotkey())
  }

  override mouseEntered(): void {
    // TODO-7.B.2.3: TooltipContainerWidget 迁移后实现
  }

  override mouseExited(): void {
    // TODO-7.B.2.3: TooltipContainerWidget 迁移后实现
  }

  override removed(): void {
    if (this.viewportTickRegistered) {
      this.viewport.offViewportTick(this.updateCameraTick)
      this.viewportTickRegistered = false
    }
    super.removed()
  }

  // ---------------------------------------------------------------------------
  // 每帧相机 Tick (由 Viewport.ViewportTick 事件触发)
  // ---------------------------------------------------------------------------

  private updateCameraTick = (): void => {
    if (this.isJoystickScrolling) {
      const rate = 0.01 * this.settings.viewportEdgeScrollStep
      const startPos = this.joystickScrollStart!
      const endPos = this.joystickScrollEnd!
      this.viewport.scroll(
        {
          x: (endPos.x - startPos.x) * rate,
          y: (endPos.y - startPos.y) * rate,
        },
        false,
      )
      return
    }

    if (this.isStandardScrolling) return

    this.edgeDirections = ScrollDirection.None
    if (
      this.settings.viewportEdgeScroll &&
      document.hasFocus()
    ) {
      this.edgeDirections = this.checkForDirections()
    }

    if (Ui.keyboardFocusWidget !== null && Ui.keyboardFocusWidget !== this) {
      this.keyboardDirections = ScrollDirection.None
    }

    if (
      this.keyboardDirections !== ScrollDirection.None ||
      this.edgeDirections !== ScrollDirection.None
    ) {
      let scrollX = 0
      let scrollY = 0

      for (const { direction, offset } of SCROLL_OFFSETS) {
        if (
          ScrollDirectionExts.includes(this.keyboardDirections, direction) ||
          ScrollDirectionExts.includes(this.edgeDirections, direction)
        ) {
          scrollX += offset.x
          scrollY += offset.y
        }
      }

      const now = performance.now()
      const deltaScale = Math.min(now - this.lastScrollTime, 25)
      const length = Math.max(
        1,
        Math.sqrt(scrollX * scrollX + scrollY * scrollY),
      )
      const step = this.settings.viewportEdgeScrollStep
      scrollX *= (deltaScale / (25 * length)) * step
      scrollY *= (deltaScale / (25 * length)) * step

      this.viewport.scroll({ x: scrollX, y: scrollY }, false)
      this.lastScrollTime = now
    }

    this.tooltipType = WorldTooltipType.None
    this.actorTooltipExtra = null
  }

  // ---------------------------------------------------------------------------
  // 边缘滚动检测
  // ---------------------------------------------------------------------------

  private checkForDirections(): ScrollDirection {
    const margin = this.settings.viewportEdgeScrollMargin
    let directions = ScrollDirection.None

    if (Viewport.lastMousePos.x < margin) directions |= ScrollDirection.Left
    if (Viewport.lastMousePos.y < margin) directions |= ScrollDirection.Up
    if (Viewport.lastMousePos.x >= Widget.windowWidth - margin)
      directions |= ScrollDirection.Right
    if (Viewport.lastMousePos.y >= Widget.windowHeight - margin)
      directions |= ScrollDirection.Down

    return directions
  }

  private get isJoystickScrolling(): boolean {
    if (!this.joystickScrollStart || !this.joystickScrollEnd) return false
    const dx = this.joystickScrollStart.x - this.joystickScrollEnd.x
    const dy = this.joystickScrollStart.y - this.joystickScrollEnd.y
    return (
      Math.sqrt(dx * dx + dy * dy) > this.settings.mouseScrollDeadzone
    )
  }

  // ---------------------------------------------------------------------------
  // 光标管理
  // ---------------------------------------------------------------------------

  override getCursor(_pos: { x: number; y: number }): string | null {
    const isScrolling = this.isJoystickScrolling || this.isStandardScrolling
    const isEdgeScrollEnabled =
      this.settings.viewportEdgeScroll && Ui.mouseOverWidget === this

    if (!isScrolling && !isEdgeScrollEnabled) return null

    const blockedDirections = this.viewport.getBlockedDirections()

    if (isScrolling) {
      for (const { direction, cursor } of JOYSTICK_CURSORS) {
        if (ScrollDirectionExts.includes(blockedDirections, direction))
          return cursor
      }
      return 'joystick-all'
    }

    for (const { direction, cursor } of SCROLL_CURSORS) {
      if (ScrollDirectionExts.includes(this.edgeDirections, direction)) {
        const blocked = ScrollDirectionExts.includes(
          blockedDirections,
          direction,
        )
        return cursor + (blocked ? '-blocked' : '')
      }
    }

    return null
  }

  // ---------------------------------------------------------------------------
  // 事件处理 — 路由键盘/鼠标到正确的处理器
  // ---------------------------------------------------------------------------

  /**
   * 统一事件处理入口。
   *
   * OpenRA 对照: HandleMouseInput + HandleKeyPress
   */
  override handleEvent(
    event: import('../../OpenRA.Game/Widgets/Widget').WidgetEvent,
  ): boolean {
    if (event.type === 'keydown' || event.type === 'keyup') {
      return this.handleKeyEvent(event)
    }
    return this.handleMouseEvent(event)
  }

  // ---------------------------------------------------------------------------
  // 键盘事件处理
  // ---------------------------------------------------------------------------

  private handleKeyEvent(
    event: import('../../OpenRA.Game/Widgets/Widget').WidgetEvent,
  ): boolean {
    const keyInput = this.eventToKeyInput(event)
    if (!keyInput) return false

    const e = keyInput

    // 滚屏热键
    if (
      this.handleMapScrollKey(this.scrollUpKey, ScrollDirection.Up, e) ||
      this.handleMapScrollKey(this.scrollDownKey, ScrollDirection.Down, e) ||
      this.handleMapScrollKey(this.scrollLeftKey, ScrollDirection.Left, e) ||
      this.handleMapScrollKey(this.scrollRightKey, ScrollDirection.Right, e)
    ) {
      return true
    }

    if (e.event !== KeyInputEvent.Down) return false

    // 缩放热键
    if (this.zoomInKey.isActivatedBy(e)) {
      this.viewport.adjustZoom(0.25)
      return true
    }
    if (this.zoomOutKey.isActivatedBy(e)) {
      this.viewport.adjustZoom(-0.25)
      return true
    }

    // 跳转到边缘热键 (通过快速滚动到地图边界实现)
    if (this.jumpToTopEdgeKey.isActivatedBy(e)) {
      this.viewport.scroll({ x: 0, y: -999999 }, true)
      return true
    }
    if (this.jumpToBottomEdgeKey.isActivatedBy(e)) {
      this.viewport.scroll({ x: 0, y: 999999 }, true)
      return true
    }
    if (this.jumpToLeftEdgeKey.isActivatedBy(e)) {
      this.viewport.scroll({ x: -999999, y: 0 }, true)
      return true
    }
    if (this.jumpToRightEdgeKey.isActivatedBy(e)) {
      this.viewport.scroll({ x: 999999, y: 0 }, true)
      return true
    }

    // 书签热键
    for (let i = 0; i < this.saveBookmarkHotkeys.length; i++) {
      if (this.saveBookmarkHotkeys[i]!.isActivatedBy(e)) {
        this.bookmarkPositions[i] = {
          x: this.viewport.centerLocation.x,
          y: this.viewport.centerLocation.y,
          z: 0,
        }
        return true
      }
    }
    for (let i = 0; i < this.restoreBookmarkHotkeys.length; i++) {
      if (this.restoreBookmarkHotkeys[i]!.isActivatedBy(e)) {
        const bookmark = this.bookmarkPositions[i]
        if (bookmark !== null && bookmark !== undefined) {
          this.viewport.centerFloat2({ x: bookmark.x, y: bookmark.y })
          return true
        }
      }
    }

    return false
  }

  private handleMapScrollKey(
    hotkey: IHotkeyReference,
    direction: ScrollDirection,
    keyInput: KeyInput,
  ): boolean {
    let isHotkey = false
    const keyValue = hotkey.getValue()

    if (keyInput.key === keyValue.key) {
      isHotkey = keyInput.key === keyValue.key
      this.keyboardDirections = ScrollDirectionExts.set(
        this.keyboardDirections,
        direction,
        keyInput.event === KeyInputEvent.Down &&
          (isHotkey || keyValue.modifiers === 0),
      )
    }

    return isHotkey
  }

  // ---------------------------------------------------------------------------
  // 鼠标事件处理
  // ---------------------------------------------------------------------------

  private handleMouseEvent(
    event: import('../../OpenRA.Game/Widgets/Widget').WidgetEvent,
  ): boolean {
    const mi = this.eventToMouseInput(event)
    if (!mi) return false

    // 滚轮缩放 (带 ZoomModifier)
    if (
      mi.event === MouseInputEvent.Scroll &&
      (mi.modifiers & this.settings.zoomModifier) !== 0
    ) {
      const dz = mi.delta.y * this.settings.zoomSpeed
      this.viewport.adjustZoomAt(dz, {
        x: mi.location.x,
        y: mi.location.y,
      })
      return true
    }

    // 确定滚动按钮
    const gs = this.settings
    const scrollButton =
      (gs.mouseControlStyle === MouseControlStyle.Classic) !==
      gs.useAlternateScrollButton
        ? MouseButton.Right
        : MouseButton.Middle

    const scrollType =
      (mi.button & scrollButton) !== 0
        ? gs.mouseScroll
        : MouseScrollType.Disabled

    if (scrollType === MouseScrollType.Disabled) {
      return this.isJoystickScrolling || this.isStandardScrolling
    }

    if (
      scrollType === MouseScrollType.Standard ||
      scrollType === MouseScrollType.Inverted
    ) {
      return this.handleStandardScrollImpl(mi, scrollType)
    }

    if (scrollType === MouseScrollType.Joystick) {
      return this.handleJoystickScrollImpl(mi)
    }

    return this.isJoystickScrolling || this.isStandardScrolling
  }

  private handleStandardScrollImpl(
    mi: MouseInput,
    scrollType: MouseScrollType,
  ): boolean {
    if (mi.event === MouseInputEvent.Down && !this.isStandardScrolling) {
      if (!this.takeMouseFocus()) return false
      this.standardScrollStart = { x: mi.location.x, y: mi.location.y }
      return true
    }

    if (
      mi.event === MouseInputEvent.Move &&
      (this.isStandardScrolling ||
        (this.standardScrollStart !== null &&
          this.calcDistance(this.standardScrollStart, mi.location) >
            this.settings.mouseScrollDeadzone))
    ) {
      this.isStandardScrolling = true
      const d = scrollType === MouseScrollType.Inverted ? -1 : 1
      this.viewport.scroll(
        {
          x: (Viewport.lastMousePos.x - mi.location.x) * d,
          y: (Viewport.lastMousePos.y - mi.location.y) * d,
        },
        false,
      )
      return true
    }

    if (mi.event === MouseInputEvent.Up) {
      const wasScrolling = this.isStandardScrolling
      this.isStandardScrolling = false
      this.standardScrollStart = null
      this.yieldMouseFocus()
      if (wasScrolling) return true
    }

    return false
  }

  private handleJoystickScrollImpl(mi: MouseInput): boolean {
    if (mi.event === MouseInputEvent.Down) {
      if (!this.takeMouseFocus()) return false
      this.joystickScrollStart = { x: mi.location.x, y: mi.location.y }
      return true
    }

    if (mi.event === MouseInputEvent.Up) {
      const wasJoystickScrolling = this.isJoystickScrolling
      this.joystickScrollStart = null
      this.joystickScrollEnd = null
      this.yieldMouseFocus()
      if (wasJoystickScrolling) return true
      return false
    }

    if (mi.event === MouseInputEvent.Move) {
      if (!this.joystickScrollStart) {
        this.joystickScrollStart = { x: mi.location.x, y: mi.location.y }
      }
      this.joystickScrollEnd = { x: mi.location.x, y: mi.location.y }
      return true
    }

    return this.isJoystickScrolling || this.isStandardScrolling
  }

  // ---------------------------------------------------------------------------
  // 焦点管理
  // ---------------------------------------------------------------------------

  override yieldMouseFocus(): boolean {
    this.joystickScrollStart = null
    this.joystickScrollEnd = null
    return super.yieldMouseFocus()
  }

  override yieldKeyboardFocus(): boolean {
    this.keyboardDirections = ScrollDirection.None
    return super.yieldKeyboardFocus()
  }

  // ---------------------------------------------------------------------------
  // 事件转换
  // ---------------------------------------------------------------------------

  private eventToMouseInput(
    event: import('../../OpenRA.Game/Widgets/Widget').WidgetEvent,
  ): MouseInput | null {
    const { type, clientX, clientY, button, deltaX, deltaY } = event
    if (clientX === undefined || clientY === undefined) return null

    let mouseEvent: MouseInputEvent
    switch (type) {
      case 'mousedown':
        mouseEvent = MouseInputEvent.Down
        break
      case 'mouseup':
        mouseEvent = MouseInputEvent.Up
        break
      case 'mousemove':
        mouseEvent = MouseInputEvent.Move
        break
      case 'wheel':
        mouseEvent = MouseInputEvent.Scroll
        break
      default:
        return null
    }

    let mouseButton: number = MouseButton.None
    switch (button as number) {
      case 0:
        mouseButton = MouseButton.Left
        break
      case 1:
        mouseButton = MouseButton.Middle
        break
      case 2:
        mouseButton = MouseButton.Right
        break
      case 3:
        mouseButton = MouseButton.X1
        break
      case 4:
        mouseButton = MouseButton.X2
        break
    }

    return {
      event: mouseEvent,
      button: mouseButton,
      location: { x: clientX as number, y: clientY as number },
      delta: { x: (deltaX as number) ?? 0, y: (deltaY as number) ?? 0 },
      modifiers: Modifiers.None,
      multiTapCount: 0,
    }
  }

  private eventToKeyInput(
    event: import('../../OpenRA.Game/Widgets/Widget').WidgetEvent,
  ): KeyInput | null {
    if (event.type !== 'keydown' && event.type !== 'keyup') return null

    return {
      event:
        event.type === 'keydown' ? KeyInputEvent.Down : KeyInputEvent.Up,
      key: (event.keyCode as number) ?? 0,
      modifiers: Modifiers.None,
      multiTapCount: 0,
      unicodeChar: '',
      isRepeat: (event.repeat as boolean) ?? false,
    }
  }

  // ---------------------------------------------------------------------------
  // 工具函数
  // ---------------------------------------------------------------------------

  private calcDistance(
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): number {
    const dx = a.x - b.x
    const dy = a.y - b.y
    return Math.sqrt(dx * dx + dy * dy)
  }
}
