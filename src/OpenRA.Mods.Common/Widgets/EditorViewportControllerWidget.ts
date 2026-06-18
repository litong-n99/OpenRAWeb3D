/**
 * EditorViewportControllerWidget.ts — 编辑器视口控制 Widget：笔刷路由、光标追踪、工具提示
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/EditorViewportControllerWidget.cs (132 lines)
 *
 * 核心范式转换:
 * - C# extends Widget + 独立视口控制 → TS extends ViewportControllerWidget (复用基础功能)
 * - C# HandleMouseInput(MouseInput) 直接接收 → TS override handleEvent(WidgetEvent) 路由
 * - C# Lazy<TooltipContainerWidget> → TS nullable tooltip (TODO: TooltipContainer 迁移)
 * - C# EditorDefaultBrush 内联构造 → TS 可选默认笔刷 + stub (TODO: EditorDefaultBrush 迁移)
 * - C# event Action BrushChanged → TS brushChangedCallback 回调
 * - C# HandleMouseInput 中直接 zoom → 基类 ViewportControllerWidget 已处理 zoom
 */

import { type WidgetArgs, type WidgetEvent } from '../../OpenRA.Game/Widgets/Widget'
import {
  ViewportControllerWidget,
  type IViewportSettings,
} from './ViewportControllerWidget'
import { Viewport } from '../../OpenRA.Game/Graphics/Viewport'
import type { Color } from '../../OpenRA.Game/Graphics/PlatformInterfaces'
import { CPos } from '../../OpenRA.Game/CPos'
import { Modifiers, MouseInputEvent, type MouseInput } from '../../OpenRA.Game/Input/IInputHandler'
import { MapGridType } from '../../OpenRA.Game/Map/MapGridType'
import type { HotkeyReference } from '../../OpenRA.Game/Input/HotkeyReference'
import type { IEditorBrush } from '../Editor/IEditorBrush'
import type { EditorCursorLayer } from '../Traits/World/EditorCursorLayer'
import type { WorldRendererStub } from '../../OpenRA.Game/Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// 编辑器默认视口设置 (对应 OpenRA 编辑器中的视口配置)
// ---------------------------------------------------------------------------

/**
 * 编辑器视口设置 — 20px 边缘滚动 + 更广的缩放范围。
 *
 * OpenRA 对照: EditorViewportControllerWidget 构造中 worldRenderer.Viewport.UnlockMinimumZoom(0.25f)
 */
export const EDITOR_VIEWPORT_SETTINGS: Partial<IViewportSettings> = {
  viewportEdgeScrollMargin: 20,
  viewportEdgeScroll: true,
}

// ---------------------------------------------------------------------------
// 默认笔刷颜色 (对应 OpenRA EditorViewportControllerWidget 字段)
// ---------------------------------------------------------------------------

/** 选择网格主色。OpenRA 对照: SelectionMainColor = Color.White */
const DEFAULT_SELECTION_MAIN_COLOR: Color = { r: 255, g: 255, b: 255, a: 255 }

/** 选择网格交替色。OpenRA 对照: SelectionAltColor = Color.Black */
const DEFAULT_SELECTION_ALT_COLOR: Color = { r: 0, g: 0, b: 0, a: 255 }

/** 粘贴预览颜色。OpenRA 对照: PasteColor = Color.FromArgb(0xFF4CFF00) */
const DEFAULT_PASTE_COLOR: Color = { r: 76, g: 255, b: 0, a: 255 }

// ---------------------------------------------------------------------------
// EditorDefaultBrushStub — EditorDefaultBrush 迁移前的临时桩
// ---------------------------------------------------------------------------

/**
 * EditorDefaultBrush 的临时桩实现。
 *
 * TODO-21.A.6-DEFER-1: EditorDefaultBrush 迁移后替换此桩
 *
 * OpenRA 对照: EditorDefaultBrush : IEditorBrush
 *
 * 此桩提供最小 IEditorBrush 实现，所有方法均为 no-op。
 * 完整实现包含选择框拖拽、actor 放置/删除、资源管理等功能。
 */
class EditorDefaultBrushStub implements IEditorBrush {
  handleMouseInput(_mi: unknown): boolean {
    return false
  }

  tick(): void { /* no-op */ }

  tickRender(_wr: WorldRendererStub, _self: { isInWorld: boolean; disposed: boolean }): void {
    /* no-op */
  }

  renderAboveShroud(
    _self: { isInWorld: boolean; disposed: boolean },
    _wr: WorldRendererStub,
  ): readonly any[] {
    return []
  }

  renderAnnotations(
    _self: { isInWorld: boolean; disposed: boolean },
    _wr: WorldRendererStub,
  ): readonly any[] {
    return []
  }

  dispose(): void { /* no-op */ }
}

// ---------------------------------------------------------------------------
// EditorViewportControllerWidget
// ---------------------------------------------------------------------------

/**
 * 编辑器视口控制 Widget：处理编辑器笔刷鼠标输入、光标追踪和工具提示。
 *
 * OpenRA 对照: class EditorViewportControllerWidget : Widget
 *
 * 职责:
 * 1. 管理活跃的编辑器笔刷 (currentBrush)
 * 2. 路由鼠标事件到笔刷 OR 处理视口平移
 * 3. 将屏幕位置转换为地图 cell 坐标 (viewportToCell)
 * 4. 管理编辑器工具提示
 * 5. 跟踪 EditorCursorLayer 光标位置
 * 6. Shift 键网格对齐切换
 *
 * 输入路由: 鼠标事件 → 笔刷 (优先) → 基类 ViewportControllerWidget (平移/缩放)
 */
export class EditorViewportControllerWidget extends ViewportControllerWidget {
  // ---------------------------------------------------------------------------
  // 选择与粘贴颜色
  // ---------------------------------------------------------------------------

  /** 选择网格主色。OpenRA 对照: SelectionMainColor */
  readonly selectionMainColor: Color

  /** 选择网格交替色。OpenRA 对照: SelectionAltColor */
  readonly selectionAltColor: Color

  /** 粘贴预览颜色。OpenRA 对照: PasteColor */
  readonly pasteColor: Color

  // ---------------------------------------------------------------------------
  // 默认笔刷
  // ---------------------------------------------------------------------------

  /** 默认笔刷（选择/操作工具）。OpenRA 对照: DefaultBrush (EditorDefaultBrush)
   *
   * TODO-21.A.6-DEFER-1: EditorDefaultBrush 迁移后用真实实现替换 */
  readonly defaultBrush: IEditorBrush

  // ---------------------------------------------------------------------------
  // 活跃笔刷 (getter/setter)
  // ---------------------------------------------------------------------------

  /** 当前活跃的编辑器笔刷。
   *
   * OpenRA 对照: CurrentBrush { get; private set; }
   */
  private _currentBrush: IEditorBrush

  /** 获取当前活跃笔刷。OpenRA 对照: CurrentBrush get */
  get currentBrush(): IEditorBrush {
    return this._currentBrush
  }

  // ---------------------------------------------------------------------------
  // 笔刷变更回调 (对应 OpenRA BrushChanged event)
  // ---------------------------------------------------------------------------

  /** 笔刷变更回调。OpenRA 对照: event Action BrushChanged */
  brushChangedCallback: (() => void) | null = null

  // ---------------------------------------------------------------------------
  // 编辑器光标层
  // ---------------------------------------------------------------------------

  /** 编辑器光标层引用。OpenRA 对照: editorCursor */
  readonly editorCursorLayer: EditorCursorLayer

  // ---------------------------------------------------------------------------
  // 世界渲染器引用 (用于坐标转换)
  // ---------------------------------------------------------------------------

  readonly worldRenderer: WorldRendererStub

  // ---------------------------------------------------------------------------
  // 选择网格交替偏移
  // ---------------------------------------------------------------------------

  /** 选择网格交替偏移量。
   *
   * OpenRA 对照: SelectionAltOffset
   *
   * 矩形地图: (1, 1), 等角地图: (0, 1)
   */
  readonly selectionAltOffset: { x: number; y: number }

  // ---------------------------------------------------------------------------
  // 工具提示配置
  // ---------------------------------------------------------------------------

  /** 工具提示容器名称。OpenRA 对照: TooltipContainer */
  tooltipContainer: string

  /** 工具提示模板名称。OpenRA 对照: TooltipTemplate */
  tooltipTemplate: string

  // ---------------------------------------------------------------------------
  // 内部状态
  // ---------------------------------------------------------------------------

  /** 网格对齐是否启用。Shift 键切换。
   *
   * 默认启用 (true) — 鼠标位置吸附到 cell 中心。
   * Shift 按住时禁用 — 允许自由放置。
   *
   * OpenRA 对照: (无直接对应，C# 中 Shift 修饰键由笔刷内部检测)
   */
  gridSnapEnabled: boolean = true

  /** 鼠标位置 (像素坐标，窗口相对)。每帧 mouseMove 事件更新。 */
  currentMousePos: { x: number; y: number } = { x: 0, y: 0 }

  /** 缓存的视口中心，用于检测视口移动以清除工具提示。
   *
   * OpenRA 对照: cachedViewportPosition */
  private cachedViewportPosition: { x: number; y: number; z: number } | null = null

  /** 工具提示是否启用 (鼠标在 Widget 内时为 true)。
   *
   * OpenRA 对照: enableTooltips */
  private enableTooltips: boolean = false

  // ---------------------------------------------------------------------------
  // 构造
  // ---------------------------------------------------------------------------

  /**
   * 创建 EditorViewportControllerWidget。
   *
   * OpenRA 对照: EditorViewportControllerWidget(WorldRenderer worldRenderer)
   *
   * @param viewport — 视口实例
   * @param editorCursorLayer — 编辑器光标层 (用于光标位置跟踪)
   * @param worldRenderer — 世界渲染器 (用于坐标转换)
   * @param mapGridType — 地图网格类型 (决定 selectionAltOffset)
   * @param settings — 视口设置 (默认使用 EDITOR_VIEWPORT_SETTINGS)
   * @param zoomInKey — 放大热键
   * @param zoomOutKey — 缩小热键
   * @param scrollUpKey — 向上滚屏热键
   * @param scrollDownKey — 向下滚屏热键
   * @param scrollLeftKey — 向左滚屏热键
   * @param scrollRightKey — 向右滚屏热键
   * @param jumpToTopEdgeKey — 跳转到顶部边缘热键
   * @param jumpToBottomEdgeKey — 跳转到底部边缘热键
   * @param jumpToLeftEdgeKey — 跳转到左侧边缘热键
   * @param jumpToRightEdgeKey — 跳转到右侧边缘热键
   */
  constructor(
    viewport: Viewport,
    editorCursorLayer: EditorCursorLayer,
    worldRenderer: WorldRendererStub,
    mapGridType: MapGridType = MapGridType.Rectangular,
    settings?: Partial<IViewportSettings>,
    zoomInKey?: HotkeyReference,
    zoomOutKey?: HotkeyReference,
    scrollUpKey?: HotkeyReference,
    scrollDownKey?: HotkeyReference,
    scrollLeftKey?: HotkeyReference,
    scrollRightKey?: HotkeyReference,
    jumpToTopEdgeKey?: HotkeyReference,
    jumpToBottomEdgeKey?: HotkeyReference,
    jumpToLeftEdgeKey?: HotkeyReference,
    jumpToRightEdgeKey?: HotkeyReference,
  ) {
    // 合并编辑器默认设置与用户传入设置
    const editorSettings = { ...EDITOR_VIEWPORT_SETTINGS, ...settings }
    super(
      viewport,
      editorSettings,
      zoomInKey,
      zoomOutKey,
      scrollUpKey,
      scrollDownKey,
      scrollLeftKey,
      scrollRightKey,
      jumpToTopEdgeKey,
      jumpToBottomEdgeKey,
      jumpToLeftEdgeKey,
      jumpToRightEdgeKey,
    )

    this.editorCursorLayer = editorCursorLayer
    this.worldRenderer = worldRenderer

    this.selectionMainColor = DEFAULT_SELECTION_MAIN_COLOR
    this.selectionAltColor = DEFAULT_SELECTION_ALT_COLOR
    this.pasteColor = DEFAULT_PASTE_COLOR

    // 默认笔刷 (桩实现，待 TODO-21.A.6-DEFER-1)
    this.defaultBrush = new EditorDefaultBrushStub()
    this._currentBrush = this.defaultBrush

    // 设置光标层的笔刷
    this.editorCursorLayer.setBrush(this._currentBrush)

    // 允许缩放到全地图大小
    this.viewport.unlockMinimumZoom(0.25)

    // 根据地图网格类型计算交替偏移
    if (mapGridType === MapGridType.Rectangular) {
      this.selectionAltOffset = { x: 1, y: 1 }
    } else {
      this.selectionAltOffset = { x: 0, y: 1 }
    }

    this.tooltipContainer = 'TOOLTIP_CONTAINER'
    this.tooltipTemplate = 'EDITOR_TOOLTIP'
  }

  // ---------------------------------------------------------------------------
  // Widget 生命周期
  // ---------------------------------------------------------------------------

  /**
   * 初始化 Widget。
   *
   * OpenRA 对照: (无显式 initialize，C# 使用 ObjectCreator 构造函数注入)
   */
  override initialize(args: WidgetArgs): void {
    super.initialize(args)
  }

  /**
   * 返回此 Widget 的 DOM 元素。
   *
   * EditorViewportControllerWidget 是全屏透明覆盖层，
   * 捕获编辑器工具输入但不渲染可见 UI 内容。
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'editor-viewport-controller-widget')
    el.style.position = 'absolute'
    el.style.left = '0'
    el.style.top = '0'
    el.style.width = '100%'
    el.style.height = '100%'
    el.style.cursor = 'inherit'
    if (this.id) {
      el.setAttribute('data-widget-id', this.id)
    }
    return el
  }

  // ---------------------------------------------------------------------------
  // 笔刷管理
  // ---------------------------------------------------------------------------

  /**
   * 清除当前笔刷（恢复为默认笔刷）。
   *
   * OpenRA 对照: ClearBrush() → SetBrush(null)
   */
  clearBrush(): void {
    this.setBrush(null)
  }

  /**
   * 设置活跃编辑器笔刷。
   *
   * OpenRA 对照: SetBrush(IEditorBrush brush)
   *
   * 如果新笔刷不是默认笔刷，则先 dispose 旧笔刷 (防止 GPU 资源泄漏)。
   * 传入 null 则恢复为默认笔刷。
   *
   * @param brush — 新笔刷，或 null 以恢复默认笔刷
   */
  setBrush(brush: IEditorBrush | null): void {
    const oldBrush = this._currentBrush

    // 释放旧笔刷资源（默认笔刷和 null 不释放）
    if (oldBrush !== null && oldBrush !== this.defaultBrush) {
      // NOTE: defaultBrush is the stub — don't try to dispose it
      try {
        oldBrush.dispose()
      } catch (_e) {
        // Ignore dispose errors (defensive)
      }
    }

    this._currentBrush = brush ?? this.defaultBrush

    // 触发笔刷变更回调
    this.brushChangedCallback?.()

    // 通知光标层笔刷变更
    this.editorCursorLayer.setBrush(this._currentBrush)
  }

  // ---------------------------------------------------------------------------
  // 鼠标进入/离开 (对应 OpenRA MouseEntered/MouseExited)
  // ---------------------------------------------------------------------------

  /**
   * 鼠标进入 Widget 时启用工具提示。
   *
   * OpenRA 对照: MouseEntered()
   */
  override mouseEntered(): void {
    this.enableTooltips = true
    super.mouseEntered()
  }

  /**
   * 鼠标离开 Widget 时移除工具提示。
   *
   * OpenRA 对照: MouseExited()
   */
  override mouseExited(): void {
    this.setTooltip(null)
    this.enableTooltips = false
    super.mouseExited()
  }

  // ---------------------------------------------------------------------------
  // 工具提示管理
  // ---------------------------------------------------------------------------

  /**
   * 设置或清除工具提示。
   *
   * OpenRA 对照: SetTooltip(string tooltip)
   *
   * @param tooltip — 工具提示文本，null 表示清除
   *
   * TODO-21.A.6-DEFER-2: TooltipContainerWidget 迁移后集成真实工具提示显示
   */
  setTooltip(tooltip: string | null): void {
    if (!this.enableTooltips) return

    if (tooltip !== null) {
      // TODO-21.A.6-DEFER-2: 集成 TooltipContainerWidget
      //   tooltipContainer.Value.SetTooltip(TooltipTemplate,
      //     new WidgetArgs() { { "getText", () => tooltip } })
    } else {
      // TODO-21.A.6-DEFER-2: 集成 TooltipContainerWidget
      //   tooltipContainer.Value.RemoveTooltip()
    }
  }

  // ---------------------------------------------------------------------------
  // 坐标转换
  // ---------------------------------------------------------------------------

  /**
   * 将屏幕像素位置转换为地图 cell 坐标。
   *
   * OpenRA 对照: (无直接对应 —— Viewport.ViewToWorld(int2) 提供此功能)
   *
   * 委托给 Viewport.viewToWorld() 进行视口像素 → 世界 cell 坐标转换。
   * 该转换考虑视口缩放、中心位置和地图网格类型。
   *
   * @param mousePos — 鼠标位置 (视口像素坐标，窗口相对)
   * @returns 对应的地图 cell 坐标 (CPos)
   */
  viewportToCell(mousePos: { x: number; y: number }): CPos {
    return this.viewport.viewToWorld({
      x: Math.round(mousePos.x),
      y: Math.round(mousePos.y),
    })
  }

  // ---------------------------------------------------------------------------
  // 事件处理: 鼠标事件 → 笔刷 OR 基类视口控制
  // ---------------------------------------------------------------------------

  /**
   * 统一事件处理入口。
   *
   * OpenRA 对照: HandleMouseInput(MouseInput mi)
   *
   * 覆盖基类以将鼠标事件首先路由到活跃笔刷。
   * 如果笔刷处理了事件，则不再进行视口操作。
   * 如果笔刷未处理，则回退到基类 (ViewportControllerWidget) 进行视口平移/缩放。
   *
   * @param event — Widget DOM 事件
   * @returns 如果事件已被处理则返回 true
   */
  override handleEvent(event: WidgetEvent): boolean {
    // 尝试转换为鼠标事件并路由到笔刷
    const mi = this.widgetEventToMouseInput(event)
    if (mi !== null) {
      // 跟踪 Shift 键状态用于网格对齐切换
      if (mi.event === MouseInputEvent.Move || mi.event === MouseInputEvent.Down) {
        this.gridSnapEnabled = (mi.modifiers & Modifiers.Shift) === 0
      }

      // 更新鼠标位置 (用于光标追踪)
      this.currentMousePos = { x: mi.location.x, y: mi.location.y }

      // 首先让笔刷处理
      if (this._currentBrush.handleMouseInput(mi)) {
        return true
      }
    }

    // 回退到基类 (ViewportControllerWidget) 进行视口平移/缩放
    return super.handleEvent(event)
  }

  /**
   * 将 WidgetEvent 转换为 MouseInput。
   *
   * 从 ViewportControllerWidget 的私有实现复制而来
   * (基类方法为 private，子类无法直接使用)。
   *
   * @param event — Widget DOM 事件
   * @returns MouseInput 或 null (如果事件不是鼠标事件)
   */
  private widgetEventToMouseInput(event: WidgetEvent): MouseInput | null {
    const { type, clientX, clientY, button, deltaX, deltaY } = event
    if (clientX === undefined || clientY === undefined) return null

    let mouseEvent: typeof MouseInputEvent[keyof typeof MouseInputEvent]
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

    let mouseButton: number = 0
    switch (button as number) {
      case 0:
        mouseButton = 1 // MouseButton.Left
        break
      case 1:
        mouseButton = 2 // MouseButton.Middle
        break
      case 2:
        mouseButton = 4 // MouseButton.Right
        break
      case 3:
        mouseButton = 8 // MouseButton.X1
        break
      case 4:
        mouseButton = 16 // MouseButton.X2
        break
    }

    return {
      event: mouseEvent,
      button: mouseButton,
      location: { x: clientX as number, y: clientY as number },
      delta: { x: (deltaX as number) ?? 0, y: (deltaY as number) ?? 0 },
      modifiers: EditorViewportControllerWidget.modsFromEvent(event),
      multiTapCount: 0,
    }
  }

  /**
   * 从浏览器事件提取修饰键位标志。
   *
   * OpenRA 对照: KeyboardEvent.ctrlKey/shiftKey/altKey/metaKey → Modifiers flags
   */
  private static modsFromEvent(event: WidgetEvent): number {
    let mods = Modifiers.None
    if (event.ctrlKey) mods |= Modifiers.Ctrl
    if (event.shiftKey) mods |= Modifiers.Shift
    if (event.altKey) mods |= Modifiers.Alt
    if (event.metaKey) mods |= Modifiers.Meta
    return mods
  }

  // ---------------------------------------------------------------------------
  // 每帧 Tick
  // ---------------------------------------------------------------------------

  /**
   * 每帧更新：检测视口移动以清除工具提示，并 tick 活跃笔刷。
   *
   * OpenRA 对照: override Tick()
   */
  override tick(): void {
    // 检测视口是否移动 (使用键盘滚屏等)
    const currentCenter = this.viewport.centerPosition
    if (this.cachedViewportPosition) {
      if (
        this.cachedViewportPosition.x !== currentCenter.x ||
        this.cachedViewportPosition.y !== currentCenter.y ||
        this.cachedViewportPosition.z !== currentCenter.z
      ) {
        this.setTooltip(null)
      }
    }
    this.cachedViewportPosition = {
      x: currentCenter.x,
      y: currentCenter.y,
      z: currentCenter.z,
    }

    // Tick 笔刷
    this._currentBrush.tick()

    // 调用基类 tick (用于 ChromeLogic 等)
    super.tick()
  }

  // ---------------------------------------------------------------------------
  // 资源清理
  // ---------------------------------------------------------------------------

  /**
   * Widget 被移除时清理资源。
   *
   * OpenRA 对照: (Widget.Removed, 隐式通过 IDisposable 模式)
   */
  override removed(): void {
    // 释放非默认笔刷的资源
    if (
      this._currentBrush !== null &&
      this._currentBrush !== this.defaultBrush
    ) {
      try {
        this._currentBrush.dispose()
      } catch (_e) {
        // Ignore dispose errors (defensive)
      }
    }

    // 释放默认笔刷
    try {
      this.defaultBrush.dispose()
    } catch (_e) {
      // Ignore dispose errors (defensive)
    }

    this._currentBrush = this.defaultBrush
    this.brushChangedCallback = null
    this.editorCursorLayer.setBrush(null)

    super.removed()
  }

  /**
   * 释放所有资源 (包括 GPU 资源)。
   *
   * NOTE: EditorCursorLayer 的生命周期由 World Actor 管理，
   * 不在此处 dispose。
   */
  dispose(): void {
    this.removed()
  }
}
