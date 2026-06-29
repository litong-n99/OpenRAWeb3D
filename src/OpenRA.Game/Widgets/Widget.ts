/**
 * Widget.ts — UI widget 组件树基类 + Ui 静态根管理器
 * OpenRA 对照: OpenRA.Game/Widgets/Widget.cs (708 lines)
 *
 * 核心范式转换:
 * - OpenRA Widget.Draw() (SDL2 bitmap 2D 渲染) → Widget.render(): HTMLElement (DOM 输出)
 * - OpenRA HandleMouseInputOuter() (手动命中测试 + 反向 Z 序事件分发)
 *   → DOM 原生事件冒泡 + stopPropagation() 控制
 * - OpenRA WindowList (Stack<Widget> 模态栈) → Ui.windowList 数组 + CSS z-index 分层
 * - OpenRA ChromeLogic (C# IDisposable) → TypeScript ChromeLogic 抽象类 (dispose 钩子)
 * - OpenRA WidgetArgs : Dictionary<string, object> → Record<string, unknown>
 * - OpenRA IntegerExpression 惰性求值 → evaluateExpression 在 initialize() 时求值
 */

import type { ModData, ObjectCreator } from '../ModData.js'

// ---------------------------------------------------------------------------
// WidgetBounds — widget 布局矩形
// OpenRA 对照: WidgetBounds struct (Widget.cs:205-217)
// ---------------------------------------------------------------------------

/** Widget 布局矩形。OpenRA 对照: WidgetBounds */
export interface WidgetBounds {
  x: number
  y: number
  width: number
  height: number
}

/** 获取 Bounds 的 left 值（x 坐标）。 */
export function boundsLeft(b: WidgetBounds): number {
  return b.x
}

/** 获取 Bounds 的 right 值（x + width）。 */
export function boundsRight(b: WidgetBounds): number {
  return b.x + b.width
}

/** 获取 Bounds 的 top 值（y 坐标）。 */
export function boundsTop(b: WidgetBounds): number {
  return b.y
}

/** 获取 Bounds 的 bottom 值（y + height）。 */
export function boundsBottom(b: WidgetBounds): number {
  return b.y + b.height
}

/** 判断点 (px, py) 是否在 bounds 内。 */
export function boundsContains(b: WidgetBounds, px: number, py: number): boolean {
  return px >= b.x && px < b.x + b.width && py >= b.y && py < b.y + b.height
}

// ---------------------------------------------------------------------------
// WidgetArgs — widget 初始化参数
// OpenRA 对照: WidgetArgs : Dictionary<string, object>
// ---------------------------------------------------------------------------

/** Widget 初始化参数。OpenRA 对照: WidgetArgs */
export type WidgetArgs = Record<string, unknown>

// ---------------------------------------------------------------------------
// WidgetEvent — widget 事件接口
// OpenRA 对照: MouseInput / KeyInput / 字符串 (HandleTextInput)
// ---------------------------------------------------------------------------

/** Widget 事件接口。
 *
 * DOM 实现: 每个 Widget 的 render() 返回 HTMLElement；
 * 容器在 DOM 节点上注册事件处理器，调用 widget.handleEventOuter(event)。
 * Container widgets 使用 pointer-events: none 实现 ClickThrough。
 *
 * OpenRA 对照: HandleMouseInput + HandleKeyPress + HandleTextInput
 */
export interface WidgetEvent {
  /** 事件类型 (e.g., 'mousedown', 'keypress', 'textinput') */
  type: string
  /** 阻止事件继续分发 */
  stopPropagation(): void
  /** 事件的目标 DOM 元素 */
  target: HTMLElement | null
  /** 鼠标/触摸事件的坐标 */
  clientX?: number
  clientY?: number
  /** 键盘事件的按键 */
  key?: string
  /** 文本输入事件的内容 */
  text?: string
  /** 其它扩展字段 */
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// ChromeLogic — widget 逻辑对象基类
// OpenRA 对照: ChromeLogic (Widget.cs:196-203)
// ---------------------------------------------------------------------------

/** Widget 逻辑对象基类。
 *
 * 每个 Widget 可以有零个或多个 ChromeLogic 对象。
 * 它们在 postInit() 期间通过 ObjectCreator 创建。
 *
 * OpenRA 对照: ChromeLogic : IDisposable
 */
export abstract class ChromeLogic {
  /** 每帧调用（由外部游戏循环驱动）。OpenRA 对照: ChromeLogic.Tick() */
  abstract tick(): void

  /** widget 被隐藏时调用（模态对话框覆盖）。OpenRA 对照: BecameHidden() */
  becameHidden(): void {}

  /** widget 被重新显示时调用（模态对话框关闭）。OpenRA 对照: BecameVisible() */
  becameVisible(): void {}

  /** 清理资源。OpenRA 对照: Dispose() */
  dispose(): void {}
}

// ---------------------------------------------------------------------------
// Widget — 抽象 widget 基类
// OpenRA 对照: Widget (Widget.cs:219-631)
// ---------------------------------------------------------------------------

/** 抽象 widget 基类 — UI 组件树的所有节点。
 *
 * 每个 Widget 有: 标识符、父子关系、布局边界、可见性标志、
 * 事件处理钩子和 DOM 渲染方法。
 *
 * OpenRA 对照: abstract class Widget
 */
export abstract class Widget {
  // ---- 标识符 (Info defined in YAML) ----

  /** Widget 标识符（从 YAML `Container@IDENTIFIER` 的 @ 后缀提取）。
   * OpenRA 对照: Widget.Id (string) */
  id: string = ''

  /** Bounds X 表达式（求值前）。OpenRA 对照: Widget.X (IntegerExpression) */
  _xExpr: string | number = 0

  /** Bounds Y 表达式（求值前）。OpenRA 对照: Widget.Y (IntegerExpression) */
  _yExpr: string | number = 0

  /** Bounds Width 表达式（求值前）。OpenRA 对照: Widget.Width (IntegerExpression) */
  _widthExpr: string | number = 0

  /** Bounds Height 表达式（求值前）。OpenRA 对照: Widget.Height (IntegerExpression) */
  _heightExpr: string | number = 0

  /** ChromeLogic 类名列表（从 YAML Logic 节点提取）。
   * OpenRA 对照: Widget.Logic (ImmutableArray<string>) */
  logic: string[] = []

  /** ChromeLogic 实例列表（postInit 后填充）。
   * OpenRA 对照: Widget.LogicObjects (ImmutableArray<ChromeLogic>) */
  logicObjects: ChromeLogic[] = []

  /** 可见性标志。OpenRA 对照: Widget.Visible (bool) */
  visible: boolean = true

  /** 是否忽略鼠标悬停检测。OpenRA 对照: Widget.IgnoreMouseOver */
  ignoreMouseOver: boolean = false

  /** 是否忽略子 widget 的鼠标悬停变化。OpenRA 对照: Widget.IgnoreChildMouseOver */
  ignoreChildMouseOver: boolean = false

  // ---- 树结构 ----

  /** 父 widget（根 widget 为 null）。OpenRA 对照: Widget.Parent */
  parent: Widget | null = null

  /** 子 widget 列表（按 Z 序排列，最后添加的在最上层）。
   * OpenRA 对照: Widget.Children (List<Widget>) */
  children: Widget[] = []

  // ---- 计算得到的属性 ----

  /** 布局边界（initialize() 期间计算）。OpenRA 对照: Widget.Bounds */
  bounds: WidgetBounds = { x: 0, y: 0, width: 0, height: 0 }

  /** postInit 是否已调用。 */
  postInitCalled: boolean = false

  /** 默认光标（从 ChromeMetrics 加载）。OpenRA 对照: defaultCursor */
  private _defaultCursor: string | null = null

  /** 缓存的 DOM 元素（由 getOrCreateElement 或子类设置）。 */
  private _element: HTMLElement | null = null

  /** 标识此 widget 是否已被 disposed。 */
  private _disposed: boolean = false

  // ---- 可见性委托 ----

  /** 可见性委托函数。OpenRA 对照: Widget.IsVisible (Func<bool>) */
  isVisible: () => boolean

  // ---- 窗口尺寸（用于表达式求值） ----

  /** 窗口宽度（像素），默认 1280。 */
  static windowWidth: number = 1280

  /** 窗口高度（像素），默认 720。 */
  static windowHeight: number = 720

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  constructor() {
    this.isVisible = () => this.visible
  }

  // ---------------------------------------------------------------------------
  // Focus properties
  // ---------------------------------------------------------------------------

  /** 此 widget 是否拥有鼠标焦点。OpenRA 对照: Widget.HasMouseFocus */
  get hasMouseFocus(): boolean {
    return Ui.mouseFocusWidget === this
  }

  /** 此 widget 是否拥有键盘焦点。OpenRA 对照: Widget.HasKeyboardFocus */
  get hasKeyboardFocus(): boolean {
    return Ui.keyboardFocusWidget === this
  }

  // ---------------------------------------------------------------------------
  // Per-frame tick
  // OpenRA 对照: Widget.Tick / TickOuter / Ui.Tick
  // ---------------------------------------------------------------------------

  /** 每帧更新。子类可重写。
   * OpenRA 对照: Widget.Tick() */
  tick(): void {}

  /** 递归 tick — 先自身，后可见子 widget，再 ChromeLogic.tick()。
   *
   * OpenRA 对照: Widget.TickOuter()
   */
  tickOuter(): void {
    if (!this.isVisible()) return
    this.tick()
    for (const child of this.children) {
      child.tickOuter()
    }
    for (const logic of this.logicObjects) {
      logic.tick()
    }
  }

  // ---------------------------------------------------------------------------
  // Tree operations
  // OpenRA 对照: AddChild / RemoveChild / RemoveChildren / HideChild
  // ---------------------------------------------------------------------------

  /** 添加子 widget。OpenRA 对照: Widget.AddChild(Widget) */
  addChild(child: Widget): void {
    if (child.parent) {
      child.parent.removeChild(child)
    }
    child.parent = this
    this.children.push(child)
  }

  /** 移除子 widget 并调用 Removed()。OpenRA 对照: Widget.RemoveChild(Widget) */
  removeChild(child: Widget): void {
    if (child) {
      const idx = this.children.indexOf(child)
      if (idx >= 0) {
        this.children.splice(idx, 1)
        child.removed()
      }
    }
  }

  /** 移除所有子 widget。OpenRA 对照: Widget.RemoveChildren() */
  removeChildren(): void {
    for (const child of this.children) {
      child?.removed()
    }
    this.children = []
  }

  /** 隐藏子 widget（从 children 移除但不 dispose）。
   *
   * 用于模态对话框场景：前一个顶层窗口被隐藏而非移除。
   * OpenRA 对照: Widget.HideChild(Widget)
   */
  hideChild(child: Widget): void {
    if (child) {
      const idx = this.children.indexOf(child)
      if (idx >= 0) {
        this.children.splice(idx, 1)
        child.hidden()
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // OpenRA 对照: Initialize / PostInit / Hidden / Removed / BecameHidden / BecameVisible
  // ---------------------------------------------------------------------------

  /** 初始化 widget — 计算 bounds，设置默认值。
   *
   * OpenRA 对照: Widget.Initialize(WidgetArgs)
   *
   * 求值顺序:
   * 1. 确定 parentBounds（根 → 窗口尺寸，非根 → 父 bounds）
   * 2. 构建 substitution 字典: WINDOW_WIDTH, WINDOW_HEIGHT, PARENT_WIDTH, PARENT_HEIGHT
   * 3. 求值 Width 和 Height（此时不含 WIDTH/HEIGHT 变量）
   * 4. 将 WIDTH, HEIGHT 加入 substitution 字典
   * 5. 求值 X 和 Y（可以引用 WIDTH/HEIGHT）
   */
  initialize(args: WidgetArgs): void {
    // 加载默认光标
    if (this._defaultCursor === null) {
      this._defaultCursor = ChromeMetrics.get<string>('DefaultCursor')
    }

    // 确定父 bounds
    const parentBounds: WidgetBounds = this.parent
      ? this.parent.bounds
      : { x: 0, y: 0, width: Widget.windowWidth, height: Widget.windowHeight }

    // 构建 substitution 字典
    const subs: Record<string, number> = args['substitutions']
      ? { ...(args['substitutions'] as Record<string, number>) }
      : {}

    subs['WINDOW_WIDTH'] = Widget.windowWidth
    subs['WINDOW_HEIGHT'] = Widget.windowHeight
    subs['PARENT_WIDTH'] = parentBounds.width
    subs['PARENT_HEIGHT'] = parentBounds.height

    // 先求值 Width 和 Height（互相不可引用）
    const width = WidgetLoader.evaluateExpression(this._widthExpr, subs)
    const height = WidgetLoader.evaluateExpression(this._heightExpr, subs)

    // 将 Width/Height 加入 subs 供 X/Y 引用
    subs['WIDTH'] = width
    subs['HEIGHT'] = height

    const x = WidgetLoader.evaluateExpression(this._xExpr, subs)
    const y = WidgetLoader.evaluateExpression(this._yExpr, subs)
    this.bounds = { x, y, width, height }
  }

  /** 两阶段初始化第二步 — 创建 ChromeLogic 实例。
   *
   * 在子 widget 递归初始化之后调用。
   * OpenRA 对照: Widget.PostInit(WidgetArgs)
   */
  postInit(args: WidgetArgs): void {
    if (this.logic.length === 0) {
      this.postInitCalled = true
      return
    }

    if (!Ui._modData) {
      this.postInitCalled = true
      return
    }

    args['widget'] = this
    const logicArgs = (args['logicArgs'] as Record<string, unknown>) ?? {}

    const objects: ChromeLogic[] = []
    for (const logicName of this.logic) {
      const logicInstance = this._createLogic(logicName, args, logicArgs)
      if (logicInstance) {
        objects.push(logicInstance)
      }
    }
    this.logicObjects = objects

    this.postInitCalled = true
  }

  /** 通过 ObjectCreator 创建 ChromeLogic 实例。 */
  private _createLogic(
    name: string,
    args: WidgetArgs,
    logicArgs: Record<string, unknown>,
  ): ChromeLogic | null {
    if (!Ui._modData) return null
    const creator: ObjectCreator = Ui._modData.objectCreator
    const inst = creator.createObject<ChromeLogic>(name, args)
    if (inst && logicArgs[name]) {
      const specificArgs = logicArgs[name] as Record<string, unknown>
      Object.assign(inst, specificArgs)
    }
    return inst
  }

  /** Widget 被隐藏时的生命周期钩子。
   * OpenRA 对照: 无（见 Ui.CloseWindow → LogicObjects.BecameHidden()） */
  becameHidden(): void {
    for (const l of this.logicObjects) {
      l.becameHidden()
    }
  }

  /** Widget 被重新显示时的生命周期钩子。
   * OpenRA 对照: 无（见 Ui.CloseWindow → LogicObjects.BecameVisible()） */
  becameVisible(): void {
    for (const l of this.logicObjects) {
      l.becameVisible()
    }
  }

  /** 隐藏时的清理 — 强制放弃焦点，递归隐藏子 widget。
   * OpenRA 对照: Widget.Hidden() */
  hidden(): void {
    this._forceYieldKeyboardFocus()
    this._forceYieldMouseFocus()

    // reverse-iterate for safety (matching OpenRA)
    for (let i = this.children.length - 1; i >= 0; i--) {
      this.children[i].hidden()
    }
  }

  /** 移除时的清理 — 强制放弃焦点，递归移除子 widget，dispose LogicObjects。
   * OpenRA 对照: Widget.Removed() */
  removed(): void {
    this._forceYieldKeyboardFocus()
    this._forceYieldMouseFocus()

    for (let i = this.children.length - 1; i >= 0; i--) {
      this.children[i].removed()
    }

    if (this.logicObjects.length > 0) {
      for (const l of this.logicObjects) {
        l.dispose()
      }
      this.logicObjects = []
    }
  }

  /** 释放 widget 资源并从父 widget 移除。
   * OpenRA 对照: 组合了 Widget.Removed() + 从父移除 */
  dispose(): void {
    if (this._disposed) return
    this._disposed = true

    this.removed()

    if (this.parent) {
      const idx = this.parent.children.indexOf(this)
      if (idx >= 0) {
        this.parent.children.splice(idx, 1)
      }
      this.parent = null
    }

    // 清理 DOM 元素
    if (this._element) {
      if (this._element.parentNode) {
        this._element.parentNode.removeChild(this._element)
      }
      this._element = null
    }
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // OpenRA 对照: Draw() / DrawOuter()
  // ---------------------------------------------------------------------------

  /** 返回此 widget 的 DOM 元素。子类必须实现。
   *
   * 子类可以使用 getOrCreateElement() 实现元素缓存。
   * OpenRA 对照: Widget.Draw()
   */
  abstract render(): HTMLElement

  /** 创建或返回缓存的 DOM 元素。
   *
   * 便利方法，子类可在 render() 中调用以实现元素缓存。
   * dispose() 时自动从 DOM 中移除缓存元素。
   *
   * @param tagName — HTML 标签名
   * @param className — 可选的 CSS 类名
   * @returns 缓存或新创建的 DOM 元素
   */
  protected getOrCreateElement(tagName: string, className?: string): HTMLElement {
    if (!this._element) {
      this._element = document.createElement(tagName)
      if (className) this._element.className = className
    }
    return this._element
  }

  /** 渲染自己 + 递归渲染子 widget 的 DOM 树。
   *
   * 按照画家算法：子 widget 渲染在父 widget 之上。
   * OpenRA 对照: Widget.DrawOuter()
   */
  renderOuter(): HTMLElement {
    if (!this.visible) {
      const hidden = document.createElement('div')
      hidden.style.display = 'none'
      hidden.setAttribute('data-widget-hidden', this.id || 'anonymous')
      return hidden
    }

    const el = this.render()

    // 应用 bounds 为 CSS 定位
    el.style.position = 'absolute'
    el.style.left = `${this.bounds.x}px`
    el.style.top = `${this.bounds.y}px`
    el.style.width = `${this.bounds.width}px`
    el.style.height = `${this.bounds.height}px`

    // 设置 widget ID 为 data 属性
    if (this.id) {
      el.setAttribute('data-widget-id', this.id)
    }

    // NOTE: 仅移除上一帧的陈旧 widget 子元素（带有 data-widget-child 标记），
    // 保留 render() 创建的内部 DOM 内容（如按钮文字、输入框、滑块轨道等）。
    // 之前的 while (el.lastChild) 会销毁所有子元素，包括 render() 刚创建的内容。
    const staleChildren = el.querySelectorAll(':scope > [data-widget-child]')
    staleChildren.forEach(c => c.remove())

    // 挂载当前子 widget，并标记为 data-widget-child 以便下一帧清理
    for (const child of this.children) {
      if (child.visible) {
        const childEl = child.renderOuter()
        childEl.setAttribute('data-widget-child', child.id || 'anonymous')
        el.appendChild(childEl)
      }
    }

    return el
  }

  // ---------------------------------------------------------------------------
  // Event handling
  // OpenRA 对照: HandleMouseInput / HandleMouseInputOuter / HandleKeyPress / etc.
  //
  // 事件分发匹配 OpenRA 的精确语义:
  // - 从最后添加的子 widget 开始（最高 Z 序）
  // - 第一个返回 true 的子 widget 捕获事件
  // - 如果没有子 widget 处理，则调用 handleEvent()
  // ---------------------------------------------------------------------------

  /** 鼠标进入此 widget 时调用。子类可重写。
   * OpenRA 对照: Widget.MouseEntered() */
  mouseEntered(): void {}

  /** 鼠标离开此 widget 时调用。子类可重写。
   * OpenRA 对照: Widget.MouseExited() */
  mouseExited(): void {}

  /** 处理事件（子类可重写）。
   *
   * 返回 true 表示事件已被消费，不应继续冒泡。
   * OpenRA 对照: Widget.HandleMouseInput(MouseInput)
   */
  handleEvent(_event: WidgetEvent): boolean {
    return false
  }

  /** 外层事件分发 — 子 widget 优先，后自身。
   *
   * OpenRA 对照: Widget.HandleMouseInputOuter(MouseInput)
   * OpenRA 对照: Widget.HandleKeyPressOuter(KeyInput)
   * OpenRA 对照: Widget.HandleTextInputOuter(string)
   *
   * 门控策略按事件类型区分:
   * - 鼠标事件: HasMouseFocus || (IsVisible && EventBoundsContains)
   * - 键盘/文本输入事件: IsVisible only（无边界检查，因 clientX/Y 默认为 0）
   *
   * 分发顺序:
   * 1. 门控检查（按事件类型）
   * 2. 从最后的子 widget 开始反向迭代（最高 Z 序优先）
   * 3. 第一个返回 true 的子 widget 捕获事件（跳过父级鼠标悬停跟踪）
   * 4. 如果没有子 widget 处理，执行鼠标悬停跟踪 + 委托给 handleEvent()
   */
  handleEventOuter(event: WidgetEvent): boolean {
    // 门控: 按事件类型区分
    // OpenRA 对照: HandleMouseInputOuter → HasMouseFocus || (IsVisible && EventBoundsContains)
    // OpenRA 对照: HandleKeyPressOuter / HandleTextInputOuter → IsVisible only
    const isKeyboardEvent =
      event.type === 'keydown' ||
      event.type === 'keyup' ||
      event.type === 'keypress' ||
      event.type === 'textinput'

    if (isKeyboardEvent) {
      if (!this.isVisible()) {
        return false
      }
    } else {
      // 鼠标事件: 拖动场景中，拥有鼠标焦点的 widget 需要接收其边界外的事件
      const posX = (event.clientX ?? 0) as number
      const posY = (event.clientY ?? 0) as number
      if (
        !(
          this.hasMouseFocus ||
          (this.isVisible() && this._eventBoundsContains(posX, posY))
        )
      ) {
        return false
      }
    }

    // 保存旧鼠标悬停，用于 IgnoreChildMouseOver 恢复
    // OpenRA 对照: var oldMouseOver = Ui.MouseOverWidget
    const oldMouseOver = Ui.mouseOverWidget

    // 反向迭代子 widget（最后添加的 = 最高 Z 序 = 先尝试）
    for (let i = this.children.length - 1; i >= 0; i--) {
      if (this.children[i].handleEventOuter(event)) {
        return true
      }
    }

    // 鼠标悬停跟踪（仅对 mousemove 事件，且只在没有子 widget 处理时执行）
    // OpenRA 对照: HandleMouseInputOuter 中的 MouseOverWidget 设置
    if (event.type === 'mousemove') {
      // 忽略子 widget 鼠标悬停变化时，恢复旧值
      if (this.ignoreChildMouseOver) {
        Ui.mouseOverWidget = oldMouseOver
      }
      // 如果还没有设置鼠标悬停且此 widget 不忽略鼠标悬停，则设为自身
      if (Ui.mouseOverWidget === null && !this.ignoreMouseOver) {
        Ui.mouseOverWidget = this
      }
    }

    // 委托给自身处理
    return this.handleEvent(event)
  }

  // ---------------------------------------------------------------------------
  // Focus management
  // OpenRA 对照: TakeMouseFocus / YieldMouseFocus / TakeKeyboardFocus / YieldKeyboardFocus
  // ---------------------------------------------------------------------------

  /** 获取鼠标焦点。
   *
   * 如果已有焦点则直接返回 true。
   * 否则先请求当前焦点 widget 释放（如果它拒绝则返回 false）。
   *
   * OpenRA 对照: Widget.TakeMouseFocus(MouseInput)
   */
  takeMouseFocus(): boolean {
    if (this.hasMouseFocus) return true

    if (Ui.mouseFocusWidget && !Ui.mouseFocusWidget.yieldMouseFocus()) {
      return false
    }

    Ui.mouseFocusWidget = this
    return true
  }

  /** 释放鼠标焦点。返回 true 表示成功释放。
   * OpenRA 对照: Widget.YieldMouseFocus(MouseInput) */
  yieldMouseFocus(): boolean {
    if (Ui.mouseFocusWidget === this) {
      Ui.mouseFocusWidget = null
    }
    return true
  }

  /** 强制放弃鼠标焦点（即使 YieldMouseFocus 返回 false）。
   * OpenRA 对照: Widget.ForceYieldMouseFocus() */
  private _forceYieldMouseFocus(): void {
    if (Ui.mouseFocusWidget === this && !this.yieldMouseFocus()) {
      Ui.mouseFocusWidget = null
    }
  }

  /** 获取键盘焦点。
   * OpenRA 对照: Widget.TakeKeyboardFocus() */
  takeKeyboardFocus(): boolean {
    if (this.hasKeyboardFocus) return true

    if (Ui.keyboardFocusWidget && !Ui.keyboardFocusWidget.yieldKeyboardFocus()) {
      return false
    }

    Ui.keyboardFocusWidget = this
    return true
  }

  /** 释放键盘焦点。OpenRA 对照: Widget.YieldKeyboardFocus() */
  yieldKeyboardFocus(): boolean {
    if (Ui.keyboardFocusWidget === this) {
      Ui.keyboardFocusWidget = null
    }
    return true
  }

  /** 强制放弃键盘焦点。OpenRA 对照: Widget.ForceYieldKeyboardFocus() */
  private _forceYieldKeyboardFocus(): void {
    if (Ui.keyboardFocusWidget === this && !this.yieldKeyboardFocus()) {
      Ui.keyboardFocusWidget = null
    }
  }

  // ---------------------------------------------------------------------------
  // Cursor
  // OpenRA 对照: GetCursor / GetCursorOuter
  // ---------------------------------------------------------------------------

  /** 获取此 widget 的光标。默认返回 defaultCursor。
   * OpenRA 对照: Widget.GetCursor(int2) */
  getCursor(_pos: { x: number; y: number }): string | null {
    return this._defaultCursor
  }

  /** 外层光标查询 — 子 widget 优先，后自身。
   *
   * 反向迭代子 widget（最高 Z 序优先），与事件分发的顺序一致。
   * OpenRA 对照: Widget.GetCursorOuter(int2)
   */
  getCursorOuter(pos: { x: number; y: number }): string | null {
    // 光标是否在我们上方？
    if (!(this.isVisible() && this._eventBoundsContains(pos.x, pos.y))) {
      return null
    }

    // 子 widget 是否指定了光标？（反向迭代 — 最高 Z 序优先）
    for (let i = this.children.length - 1; i >= 0; i--) {
      const cc = this.children[i].getCursorOuter(pos)
      if (cc !== null) return cc
    }

    // 只有点在 EventBounds 内时才返回光标
    return boundsContains(this.bounds, pos.x, pos.y)
      ? this.getCursor(pos)
      : null
  }

  /** 检查点是否在事件边界内（bounds 或任意子 widget 的 bounds）。
   * OpenRA 对照: Widget.EventBoundsContains(int2) */
  protected _eventBoundsContains(px: number, py: number): boolean {
    if (boundsContains(this.bounds, px, py)) return true

    for (const child of this.children) {
      if (child.isVisible() && child._eventBoundsContains(px, py)) {
        return true
      }
    }

    return false
  }

  // ---------------------------------------------------------------------------
  // Lookup
  // OpenRA 对照: GetOrNull / Get
  // ---------------------------------------------------------------------------

  /** 按 ID 递归查找 widget。
   *
   * 深度优先搜索整个子树。
   * OpenRA 对照: Widget.GetOrNull(string)
   */
  getOrNull<T extends Widget>(id: string): T | null {
    if (this.id === id) return this as unknown as T

    for (const child of this.children) {
      const w = child.getOrNull<T>(id)
      if (w !== null) return w
    }

    return null
  }

  /** 按 ID 递归查找 widget（找不到则抛出异常）。
   * OpenRA 对照: Widget.Get<T>(string) */
  get<T extends Widget>(id: string): T {
    const t = this.getOrNull<T>(id)
    if (t === null) {
      throw new Error(
        `Widget ${this.id || 'anonymous'} has no child ${id} of type Widget`,
      )
    }
    return t
  }

  // ---------------------------------------------------------------------------
  // Clone
  // OpenRA 对照: Widget.Clone()
  // ---------------------------------------------------------------------------

  /** 克隆此 widget。默认不支持（抛出异常）。
   *
   * 支持克隆的子类必须重写此方法。
   * OpenRA 对照: Widget.Clone()
   */
  clone(): Widget {
    throw new Error(
      `Widget type '${this.constructor.name}' is not cloneable.`,
    )
  }
}

// ---------------------------------------------------------------------------
// ContainerWidget — 容器 widget（无额外行为）
// OpenRA 对照: ContainerWidget (Widget.cs:633-652)
// ---------------------------------------------------------------------------

/** 容器 widget — 纯容器，无交互逻辑。
 *
 * 用于根节点和中间分组节点。默认忽略鼠标悬停。
 * ClickThrough 控制容器本身是否消费鼠标事件。
 *
 * OpenRA 对照: ContainerWidget : Widget
 */
export class ContainerWidget extends Widget {
  /** 点击穿透 — 如果为 true，容器不消费鼠标点击。
   * OpenRA 对照: ContainerWidget.ClickThrough */
  clickThrough: boolean = true

  constructor() {
    super()
    this.ignoreMouseOver = true
  }

  /** 容器没有默认光标。OpenRA 对照: ContainerWidget.GetCursor() */
  override getCursor(_pos: { x: number; y: number }): string | null {
    return null
  }

  /** 容器事件处理: ClickThrough=false 时消费边界内的事件。
   *
   * 注意: 使用 boundsContains (仅自身渲染边界)，而非 _eventBoundsContains
   * （后者会递归检查子 widget）。匹配 OpenRA 的 EventBounds.Contains，
   * 其中 EventBounds 指向 RenderBounds（不包含子 widget）。
   *
   * OpenRA 对照: ContainerWidget.HandleMouseInput(MouseInput)
   */
  override handleEvent(event: WidgetEvent): boolean {
    if (this.clickThrough) return false
    const x = (event.clientX ?? 0) as number
    const y = (event.clientY ?? 0) as number
    return boundsContains(this.bounds, x, y)
  }

  /** 容器支持克隆。OpenRA 对照: ContainerWidget.Clone() */
  override clone(): ContainerWidget {
    const c = new ContainerWidget()
    c.id = this.id
    c._xExpr = this._xExpr
    c._yExpr = this._yExpr
    c._widthExpr = this._widthExpr
    c._heightExpr = this._heightExpr
    c.logic = [...this.logic]
    c.visible = this.visible
    c.clickThrough = this.clickThrough
    c.ignoreMouseOver = this.ignoreMouseOver
    c.ignoreChildMouseOver = this.ignoreChildMouseOver
    c.bounds = { ...this.bounds }
    for (const child of this.children) {
      c.addChild(child.clone())
    }
    return c
  }

  /** 返回容器 div 元素（通过 getOrCreateElement 缓存）。
   * OpenRA 对照: ContainerWidget.Draw() */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'container-widget')
    el.style.position = 'absolute'
    if (this.clickThrough) {
      el.style.pointerEvents = 'none'
    } else {
      el.style.pointerEvents = ''
    }
    if (this.id) {
      el.id = `widget-${this.id}`
      el.setAttribute('data-widget-id', this.id)
    }
    return el
  }
}

// ---------------------------------------------------------------------------
// InputWidget — 输入控件基类
// OpenRA 对照: InputWidget (Widget.cs:654-671)
// ---------------------------------------------------------------------------

/** 输入控件基类 — 带禁用状态的 widget。
 *
 * 所有交互式控件（按钮、文本框、滑块）都继承自此类。
 *
 * OpenRA 对照: InputWidget : Widget
 */
export abstract class InputWidget extends Widget {
  /** 是否禁用。OpenRA 对照: InputWidget.Disabled */
  disabled: boolean = false

  /** 禁用状态委托。OpenRA 对照: InputWidget.IsDisabled */
  isDisabled: () => boolean

  constructor() {
    super()
    this.isDisabled = () => this.disabled
  }

  /** 获取是否禁用。 */
  get disabledStatus(): boolean {
    return this.isDisabled()
  }

  // InputWidget.Clone() support requires factory/registry pattern.
  // Widget.Clone() throws by default; InputWidget subclasses must override.
}

// ---------------------------------------------------------------------------
// Ui — 静态根管理器
// OpenRA 对照: Ui static class (Widget.cs:24-194)
// ---------------------------------------------------------------------------

/** UI 系统的静态根管理器。
 *
 * 持有根 ContainerWidget、模态窗口栈、焦点跟踪和 ModData 引用。
 *
 * OpenRA 对照: public static class Ui
 */
export class Ui {
  /** 根容器 widget。OpenRA 对照: Ui.Root */
  static root: ContainerWidget = new ContainerWidget()

  /** 模态窗口栈（最后一个 = 顶层）。
   * OpenRA 对照: WindowList (Stack<Widget>) */
  static windowList: Widget[] = []

  /** 拥有鼠标焦点的 widget。OpenRA 对照: Ui.MouseFocusWidget */
  static mouseFocusWidget: Widget | null = null

  /** 拥有键盘焦点的 widget。OpenRA 对照: Ui.KeyboardFocusWidget */
  static keyboardFocusWidget: Widget | null = null

  /** 鼠标悬停的 widget。OpenRA 对照: Ui.MouseOverWidget */
  static mouseOverWidget: Widget | null = null

  /** ModData 引用（initialize() 时设置）。 */
  static _modData: ModData | null = null

  /** WidgetLoader 引用（由外部在创建后设置）。 */
  static _widgetLoader: WidgetLoader | null = null

  // ---- 特殊 widget 引用 (用于全局查找) ----

  /** 初始化 Ui — 存储 ModData 引用。
   * OpenRA 对照: Ui.Initialize(ModData)
   */
  static initialize(modData: ModData): void {
    Ui._modData = modData
    Ui.root.id = 'root'
  }

  // ---------------------------------------------------------------------------
  // Window management
  // OpenRA 对照: OpenWindow / CloseWindow / CurrentWindow
  // ---------------------------------------------------------------------------

  /** 打开模态窗口。
   *
   * 通过 WidgetLoader 加载指定 ID 的 widget，推入 windowList 栈。
   * 如果已有窗口打开，隐藏前一个（调用 becameHidden 生命周期钩子）。
   *
   * OpenRA 对照: Ui.OpenWindow(string, WidgetArgs)
   */
  static openWindow(id: string, args?: WidgetArgs): Widget {
    if (!Ui._widgetLoader) {
      throw new Error('Ui.openWindow: WidgetLoader not set. Call Ui.setWidgetLoader() first.')
    }

    const mergedArgs: WidgetArgs = { ...args }
    if (!('modData' in mergedArgs) && Ui._modData) {
      mergedArgs['modData'] = Ui._modData
    }

    const window = Ui._widgetLoader.loadWidgetById(mergedArgs, Ui.root, id)

    // NOTE: OpenRA's OpenWindow hides the previous window via HideChild
    // but does NOT call BecameHidden() — that only fires in CloseWindow().
    if (Ui.windowList.length > 0) {
      Ui.root.hideChild(Ui.windowList[Ui.windowList.length - 1])
    }

    Ui.windowList.push(window)
    return window
  }

  /** 关闭顶层模态窗口。
   *
   * 从 windowList 弹出顶层窗口，从根移除并调用 becameHidden 钩子。
   * 如果还有下层窗口，将其重新添加到根并调用 becameVisible 钩子。
   *
   * OpenRA 对照: Ui.CloseWindow()
   */
  static closeWindow(): void {
    if (Ui.windowList.length === 0) return

    const hidden = Ui.windowList.pop()!
    Ui.root.removeChild(hidden)
    hidden.becameHidden()

    if (Ui.windowList.length > 0) {
      const restore = Ui.windowList[Ui.windowList.length - 1]
      Ui.root.addChild(restore)
      restore.becameVisible()
    }
  }

  /** 获取当前顶层窗口。OpenRA 对照: Ui.CurrentWindow() */
  static currentWindow(): Widget | null {
    return Ui.windowList.length > 0 ? Ui.windowList[Ui.windowList.length - 1] : null
  }

  // ---------------------------------------------------------------------------
  // Widget loading helpers
  // OpenRA 对照: LoadWidget<T> / LoadWidget
  // ---------------------------------------------------------------------------

  /** 加载具有类型检查的 widget。如果类型不匹配则抛出异常。
   * OpenRA 对照: Ui.LoadWidget<T>(string, Widget, WidgetArgs)
   */
  static loadWidget<T extends Widget>(
    id: string,
    parent: Widget | null,
    args: WidgetArgs,
  ): T {
    if (!Ui._widgetLoader) {
      throw new Error('Ui.loadWidget: WidgetLoader not set.')
    }

    const mergedArgs: WidgetArgs = { ...args }
    if (!('modData' in mergedArgs) && Ui._modData) {
      mergedArgs['modData'] = Ui._modData
    }

    const widget = Ui._widgetLoader.loadWidgetById(mergedArgs, parent, id)
    return widget as T
  }

  // ---------------------------------------------------------------------------
  // Set WidgetLoader (after construction)
  // ---------------------------------------------------------------------------

  /** 设置 WidgetLoader 实例。在 WidgetLoader 创建后调用。 */
  static setWidgetLoader(loader: WidgetLoader): void {
    Ui._widgetLoader = loader
  }

  // ---------------------------------------------------------------------------
  // Per-frame tick
  // OpenRA 对照: Ui.Tick()
  // ---------------------------------------------------------------------------

  /** 每帧 tick 整个 widget 树。
   * 应在游戏主循环中每帧调用。
   * OpenRA 对照: Ui.Tick() */
  static tick(): void {
    Ui.root.tickOuter()
  }

  // ---------------------------------------------------------------------------
  // Reset
  // OpenRA 对照: ResetAll / ResetTooltips
  // ---------------------------------------------------------------------------

  /** 重置所有 UI — 清除根的子 widget 和窗口栈。
   * OpenRA 对照: Ui.ResetAll()
   */
  static resetAll(): void {
    Ui.root.removeChildren()

    while (Ui.windowList.length > 0) {
      Ui.closeWindow()
    }

    Ui.mouseFocusWidget = null
    Ui.keyboardFocusWidget = null
    Ui.mouseOverWidget = null
  }

  /** 重置提示 — 发出空操作鼠标移动以强制重新计算提示。
   * OpenRA 对照: Ui.ResetTooltips()
   */
  static resetTooltips(): void {
    Ui.handleInput({
      type: 'mousemove',
      stopPropagation: () => {},
      target: null,
      clientX: 0,
      clientY: 0,
    })
  }

  // ---------------------------------------------------------------------------
  // Event dispatch
  // OpenRA 对照: HandleInput / HandleKeyPress / HandleTextInput
  // ---------------------------------------------------------------------------

  /** 处理输入事件。
   *
   * 分发顺序:
   * 1. 如果存在 mouseFocusWidget，先尝试其子树
   * 2. 如果未处理，尝试根 widget 的子树
   * 3. 对于移动事件，跟踪 mouseOverWidget
   *
   * OpenRA 对照: Ui.HandleInput(MouseInput)
   */
  static handleInput(event: WidgetEvent): boolean {
    const wasMouseOver = Ui.mouseOverWidget

    if (event.type === 'mousemove') {
      Ui.mouseOverWidget = null
    }

    let handled = false
    if (Ui.mouseFocusWidget) {
      handled = Ui.mouseFocusWidget.handleEventOuter(event)
    }

    if (!handled) {
      handled = Ui.root.handleEventOuter(event)
    }

    // 鼠标悬停变化通知
    if (wasMouseOver !== Ui.mouseOverWidget) {
      wasMouseOver?.mouseExited()
      Ui.mouseOverWidget?.mouseEntered()
    }

    return handled
  }

  /** 处理键盘事件。
   *
   * 如果存在 keyboardFocusWidget，路由到其子树；否则路由到根。
   * OpenRA 对照: Ui.HandleKeyPress(KeyInput)
   */
  static handleKeyPress(event: WidgetEvent): boolean {
    if (Ui.keyboardFocusWidget) {
      return Ui.keyboardFocusWidget.handleEventOuter(event)
    }
    return Ui.root.handleEventOuter(event)
  }

  /** 处理文本输入事件。
   *
   * 如果存在 keyboardFocusWidget，路由到其子树；否则路由到根。
   * OpenRA 对照: Ui.HandleTextInput(string)
   */
  static handleTextInput(text: string): boolean {
    const event: WidgetEvent = {
      type: 'textinput',
      text,
      stopPropagation: () => {},
      target: null,
    }
    if (Ui.keyboardFocusWidget) {
      return Ui.keyboardFocusWidget.handleEventOuter(event)
    }
    return Ui.root.handleEventOuter(event)
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /** 释放 Ui 资源。 */
  static dispose(): void {
    Ui.resetAll()
    Ui.root.dispose()
    Ui._modData = null
    Ui._widgetLoader = null
  }
}

// ---------------------------------------------------------------------------
// Forward declarations for circular dependency resolution
// (imported at bottom to resolve circular references)
// ---------------------------------------------------------------------------

import { ChromeMetrics } from './ChromeMetrics.js'
import { WidgetLoader } from './WidgetLoader.js'
