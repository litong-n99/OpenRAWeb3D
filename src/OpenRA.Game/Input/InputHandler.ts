/**
 * InputHandler.ts — 输入处理器实现 (NullInputHandler, DefaultInputHandler, InputManager)
 * OpenRA 对照: OpenRA.Game/Input/InputHandler.cs (53 lines)
 *
 * 核心范式转换:
 * - C# NullInputHandler (所有方法空操作) → TS NullInputHandler (零副作用 no-op)
 * - C# DefaultInputHandler (World + Sync.RunUnsynced) → TS DefaultInputHandler
 *   (基于 Observable 的输入分派, 暂使用存根函数进行 Widget/Game 路由)
 * - C# SDL2 事件循环 → 浏览器 DOM 事件 (通过 InputManager 封装)
 * - 新增 InputManager 类 (无 C# 对应): 封装 DeviceSourceManager + 事件转换
 *
 * 调度架构:
 * ```
 * DeviceSourceManager  →  InputManager  →  IInputHandler  →  Widget 树
 * (键盘/鼠标/触控)       (事件翻译层)      (接口分派)        (UI 处理)
 * ```
 */

import { type IInputHandler, type MouseInput, type KeyInput } from './IInputHandler'
import {
  MouseInputEvent,
  KeyInputEvent,
  MouseButton,
  Modifiers,
} from './IInputHandler'
import { KeyCode, keyCodeFromKeyboardEvent, isBrowserReservedKey } from './Keycode'

// ---------------------------------------------------------------------------
// NullInputHandler (对应 OpenRA NullInputHandler 类)
// ---------------------------------------------------------------------------

/**
 * 空输入处理器 — 所有输入事件被静默丢弃。
 *
 * OpenRA 对照: NullInputHandler : IInputHandler
 *
 * 使用场景:
 * - 专用服务器 (无需本地交互)
 * - 回放播放 (输入来自日志文件而非设备)
 * - 无头测试模式 (自动化测试无需 UI)
 * - 基准性能测试 (排除输入干扰)
 */
export class NullInputHandler implements IInputHandler {
  /** 无操作。 */
  modifierKeys(_mods: Modifiers): void {
    // 空操作 — 无头模式下忽略修饰键状态变更
  }

  /** 无操作。 */
  onKeyInput(_input: KeyInput): void {
    // 空操作 — 无头模式下忽略键盘事件
  }

  /** 无操作。 */
  onMouseInput(_input: MouseInput): void {
    // 空操作 — 无头模式下忽略鼠标事件
  }

  /** 无操作。 */
  onTextInput(_text: string): void {
    // 空操作 — 无头模式下忽略文本输入事件
  }

  dispose(): void {
    // NullInputHandler 不持有任何资源，无需清理
  }
}

// ---------------------------------------------------------------------------
// 输入路由回调存根类型 (用于 DefaultInputHandler，等待 Game/Ui 模块迁移)
// ---------------------------------------------------------------------------

/**
 * 输入路由回调集合。
 *
 * 在完整的 OpenRA 迁移中，这些回调指向:
 * - Game.HandleModifierKeys(mods) — 更新全局修饰键状态 + 显示按键绑定提示
 * - Ui.HandleKeyPress(input) — 通过 Widget 树处理键盘事件
 * - Ui.HandleTextInput(text) — 路由文本输入到焦点 Widget
 * - Ui.HandleInput(input) — 通过 Widget 树处理鼠标事件
 *
 * 当前这些函数在 Widget 系统中以 Sync.RunUnsynced(world, ...) 模式调用，
 * 确保输入处理在对齐到渲染帧的同时不受同步锁影响。
 *
 * TODO-7.A.2: 当 Game/Ui 模块迁移完成后，替换为实际引用。
 */
export interface InputRouteCallbacks {
  modifierKeys?: (mods: Modifiers) => void
  keyPress?: (input: KeyInput) => void
  textInput?: (text: string) => void
  mouseInput?: (input: MouseInput) => void
}

// ---------------------------------------------------------------------------
// DefaultInputHandler (对应 OpenRA DefaultInputHandler 类)
// ---------------------------------------------------------------------------

/**
 * 默认输入处理器 — 将输入事件路由到游戏逻辑和 Widget 系统。
 *
 * OpenRA 对照: DefaultInputHandler : IInputHandler
 *
 * 在 OpenRA 中，每个方法通过 Sync.RunUnsynced(world, ...) 包装调用。
 * 在迁移版本中，输入路由通过注入的回调集合进行，以保持模块解耦。
 *
 * 使用场景:
 * - 正常游戏 (本地单人/多人)
 * - 编辑器模式
 * - 所有需要交互式输入的运行时模式
 */
export class DefaultInputHandler implements IInputHandler {
  private readonly _callbacks: InputRouteCallbacks

  /**
   * 创建默认输入处理器。
   *
   * OpenRA 对照: DefaultInputHandler(World world)
   *
   * @param callbacks — 输入路由回调集合。至少提供一个非空集合。
   */
  constructor(callbacks: InputRouteCallbacks) {
    this._callbacks = callbacks
  }

  /** 处理修饰键状态变更。
   *
   * OpenRA 对照: void DefaultInputHandler.ModifierKeys(Modifiers mods)
   */
  modifierKeys(mods: Modifiers): void {
    this._callbacks.modifierKeys?.(mods)
  }

  /** 处理键盘按键事件。
   *
   * OpenRA 对照: void DefaultInputHandler.OnKeyInput(KeyInput input)
   */
  onKeyInput(input: KeyInput): void {
    this._callbacks.keyPress?.(input)
  }

  /** 处理文本输入事件 (IME 感知)。
   *
   * OpenRA 对照: void DefaultInputHandler.OnTextInput(string text)
   */
  onTextInput(text: string): void {
    this._callbacks.textInput?.(text)
  }

  /** 处理鼠标输入事件。
   *
   * OpenRA 对照: void DefaultInputHandler.OnMouseInput(MouseInput input)
   */
  onMouseInput(input: MouseInput): void {
    this._callbacks.mouseInput?.(input)
  }

  /**
   * 清理 DefaultInputHandler 资源。
   */
  dispose(): void {
    // DefaultInputHandler 本身不持有资源。
    // 实际的事件监听器由 InputManager 管理。
  }
}

// ---------------------------------------------------------------------------
// InputManager (新增，无 C# 对应 — 封装 DeviceSourceManager + DOM 事件)
// ---------------------------------------------------------------------------

/**
 * 输入管理器 — 整合 Babylon.js DeviceSourceManager 和浏览器 DOM 事件，
 * 将其转换为 OpenRA 兼容的输入事件格式，并路由到 IInputHandler。
 *
 * 此类型在 OpenRA 中没有直接对应类。在 OpenRA 中，SDL2 事件循环在
 * Sdl2Input.cs 中进行轮询，并通过 Game.cs 的主循环分派事件。
 * 在浏览器环境中，事件驱动模型不需要轮询循环；InputManager 作为适配层，
 * 将浏览器事件翻译为 OpenRA 输入抽象。
 *
 * 职责:
 * - 注册 DeviceSourceManager 观察器 (键盘)
 * - 注册 DOM 指针事件观察器 (鼠标移动/点击/滚轮)
 * - NDC → 像素坐标转换
 * - 修饰键状态跟踪
 * - 浏览器保留键检测和过滤
 * - 滚轮事件 preventDefault (防止页面滚动)
 */
export class InputManager {
  // 注意: 实际集成需要 @babylonjs/core 的 DeviceSourceManager
  // 当前阶段提供接口和事件管道结构，实际的 DSM 连接在运行时集成阶段完成

  private _handler: IInputHandler
  private _disposed = false

  // 跟踪修饰键状态 (用于构建 KeyInput/MouseInput 的 modifiers 字段)
  private _modifiersState: Modifiers = Modifiers.None
  private _keyRepeatCounts: Map<number, number> = new Map()

  // 鼠标状态跟踪
  private _mousePosition: { x: number; y: number } = { x: 0, y: 0 }
  private _multiTapCount = 0
  private _lastClickTime = 0
  private _lastClickPosition: { x: number; y: number } = { x: 0, y: 0 }

  // 事件监听器引用 (用于 dispose 清理)
  private _attachedElement: HTMLElement | null = null
  private _onKeyDown: ((e: KeyboardEvent) => void) | null = null
  private _onKeyUp: ((e: KeyboardEvent) => void) | null = null
  private _onPointerDown: ((e: PointerEvent) => void) | null = null
  private _onPointerMove: ((e: PointerEvent) => void) | null = null
  private _onPointerUp: ((e: PointerEvent) => void) | null = null
  private _onWheel: ((e: WheelEvent) => void) | null = null

  /**
   * 创建输入管理器。
   *
   * @param handler — 输入事件路由目标 (NullInputHandler 或 DefaultInputHandler)
   */
  constructor(handler: IInputHandler) {
    this._handler = handler
  }

  // -----------------------------------------------------------------------
  // 公共 API
  // -----------------------------------------------------------------------

  /**
   * 绑定输入事件监听器到指定的 HTML 元素 (通常是渲染 canvas)。
   *
   * 在绑定前先调用 `dispose()` 以确保不会重复绑定。
   *
   * @param element — 接收输入事件的 HTML 元素
   */
  attach(element: HTMLElement): void {
    // 确保之前的监听器已清除
    this.detach()

    this._attachedElement = element

    this._onKeyDown = (e: KeyboardEvent) => this._handleKeyDown(e)
    this._onKeyUp = (e: KeyboardEvent) => this._handleKeyUp(e)
    this._onPointerDown = (e: PointerEvent) => this._handlePointerDown(e)
    this._onPointerMove = (e: PointerEvent) => this._handlePointerMove(e)
    this._onPointerUp = (e: PointerEvent) => this._handlePointerUp(e)
    this._onWheel = (e: WheelEvent) => this._handleWheel(e)

    element.addEventListener('keydown', this._onKeyDown)
    element.addEventListener('keyup', this._onKeyUp)
    element.addEventListener('pointerdown', this._onPointerDown)
    element.addEventListener('pointermove', this._onPointerMove)
    element.addEventListener('pointerup', this._onPointerUp)
    // wheel 事件需要 { passive: false } 才能调用 preventDefault
    element.addEventListener('wheel', this._onWheel, { passive: false })
  }

  /**
   * 解绑所有输入事件监听器。
   *
   * @param element — 之前绑定的 HTML 元素 (必须与 attach 时相同)
   */
  detach(element?: HTMLElement): void {
    // 如果没有提供 element，监听器引用仍然会被清空;
    // 但实际的 DOM 移除需要相同元素。调用者负责传递正确的元素。
    if (element) {
      if (this._onKeyDown) element.removeEventListener('keydown', this._onKeyDown)
      if (this._onKeyUp) element.removeEventListener('keyup', this._onKeyUp)
      if (this._onPointerDown) element.removeEventListener('pointerdown', this._onPointerDown)
      if (this._onPointerMove) element.removeEventListener('pointermove', this._onPointerMove)
      if (this._onPointerUp) element.removeEventListener('pointerup', this._onPointerUp)
      if (this._onWheel) element.removeEventListener('wheel', this._onWheel)
    }

    this._attachedElement = null
    this._onKeyDown = null
    this._onKeyUp = null
    this._onPointerDown = null
    this._onPointerMove = null
    this._onPointerUp = null
    this._onWheel = null
  }

  /**
   * 获取当前鼠标位置 (像素坐标)。
   */
  get mousePosition(): { readonly x: number; readonly y: number } {
    return this._mousePosition
  }

  /**
   * 获取当前修饰键状态。
   */
  get modifiersState(): Modifiers {
    return this._modifiersState
  }

  /**
   * 设置输入处理器 (用于运行时切换 headless/interactive 模式)。
   *
   * @param handler — 新的输入处理器
   */
  setHandler(handler: IInputHandler): void {
    this._handler = handler
  }

  /**
   * 获取当前输入处理器。
   */
  getHandler(): IInputHandler {
    return this._handler
  }

  /**
   * 编排所有输入相关的初始化，用于游戏启动时的标准设置。
   *
   * 这是为正常交互式游戏推荐的一站式初始化方法。
   *
   * @param canvas — 渲染 canvas 元素
   * @param callbacks — 输入路由回调 (传递给 DefaultInputHandler)
   * @returns 配置好的 InputManager 实例
   */
  static createDefault(
    canvas: HTMLElement,
    callbacks: InputRouteCallbacks,
  ): InputManager {
    const handler = new DefaultInputHandler(callbacks)
    const manager = new InputManager(handler)
    manager.attach(canvas)
    return manager
  }

  /**
   * 为无头/测试模式创建 null 输入管理器。
   *
   * @returns 配置为无操作的 InputManager 实例
   */
  static createNull(): InputManager {
    const handler = new NullInputHandler()
    return new InputManager(handler)
  }

  /**
   * 清理所有事件监听器和内部状态。
   *
   * 调用后此 InputManager 实例不应再使用。
   */
  dispose(): void {
    if (this._disposed) return
    this._disposed = true

    this.detach()
    this._keyRepeatCounts.clear()
    this._handler = new NullInputHandler()
  }

  // -----------------------------------------------------------------------
  // 内部事件处理器
  // -----------------------------------------------------------------------

  /** 从 KeyboardEvent 中推断修饰键位标志。 */
  private _extractModifiers(event: KeyboardEvent | PointerEvent | WheelEvent): Modifiers {
    let mods: Modifiers = Modifiers.None
    if (event.shiftKey) mods |= Modifiers.Shift
    if (event.altKey) mods |= Modifiers.Alt
    if (event.ctrlKey) mods |= Modifiers.Ctrl
    if (event.metaKey) mods |= Modifiers.Meta
    return mods
  }

  /** 将 MouseEvent buttons 位掩码转换为 MouseButton 标志。 */
  private _extractMouseButtons(event: PointerEvent): MouseButton {
    // PointerEvent.buttons 位掩码: 0=none, 1=left, 2=right, 4=middle, 8=X1(back), 16=X2(forward)
    let btn: MouseButton = MouseButton.None
    if (event.buttons & 1) btn |= MouseButton.Left
    if (event.buttons & 2) btn |= MouseButton.Right
    if (event.buttons & 4) btn |= MouseButton.Middle
    if (event.buttons & 8) btn |= MouseButton.X1
    if (event.buttons & 16) btn |= MouseButton.X2
    return btn
  }

  /** 将 PointerEvent.button 转换为 MouseButton 标志 (用于 Down/Up 事件)。 */
  private _pointerButtonToMouseButton(button: number): MouseButton {
    switch (button) {
      case 0: return MouseButton.Left
      case 1: return MouseButton.Middle
      case 2: return MouseButton.Right
      case 3: return MouseButton.X1
      case 4: return MouseButton.X2
      default: return MouseButton.None
    }
  }

  /** 计算多点触控/多次点击计数。 */
  private _updateMultiTapCount(x: number, y: number, time: number): number {
    const doubleClickDistance = 4 // 像素
    const doubleClickTime = 500 // 毫秒

    const dx = Math.abs(x - this._lastClickPosition.x)
    const dy = Math.abs(y - this._lastClickPosition.y)
    const dt = time - this._lastClickTime

    if (dx <= doubleClickDistance && dy <= doubleClickDistance && dt <= doubleClickTime) {
      this._multiTapCount++
    } else {
      this._multiTapCount = 1
    }

    this._lastClickPosition = { x, y }
    this._lastClickTime = time
    return this._multiTapCount
  }

  // -----------------------------------------------------------------------
  // 键盘事件处理
  // -----------------------------------------------------------------------

  private _handleKeyDown(event: KeyboardEvent): void {
    if (this._disposed) return

    // 检查并过滤浏览器保留键
    if (isBrowserReservedKey(event)) {
      // 注意: 浏览器保留键不会被 preventDefault 阻止。
      // 它们仅被过滤，避免被游戏逻辑处理。浏览器自身行为不受影响。
      return
    }

    const keyCode = keyCodeFromKeyboardEvent(event)
    const mods = this._extractModifiers(event)

    // 更新修饰键状态
    if (
      keyCode === KeyCode.LSHIFT || keyCode === KeyCode.RSHIFT ||
      keyCode === KeyCode.LALT || keyCode === KeyCode.RALT ||
      keyCode === KeyCode.LCTRL || keyCode === KeyCode.RCTRL ||
      keyCode === KeyCode.LGUI || keyCode === KeyCode.RGUI
    ) {
      const prevMods = this._modifiersState
      this._modifiersState = mods
      if (prevMods !== mods) {
        this._handler.modifierKeys(mods)
      }
    }

    // 跟踪按键重复
    const prevCount = this._keyRepeatCounts.get(keyCode) ?? 0
    const multiTapCount = prevCount + 1
    this._keyRepeatCounts.set(keyCode, multiTapCount)

    const keyInput: KeyInput = {
      event: KeyInputEvent.Down,
      key: keyCode,
      modifiers: mods,
      multiTapCount,
      unicodeChar: event.key && event.key.length === 1 ? event.key : '',
      isRepeat: event.repeat,
    }

    this._handler.onKeyInput(keyInput)

    // 防止默认行为 (游戏应完全控制输入)
    event.preventDefault()
  }

  private _handleKeyUp(event: KeyboardEvent): void {
    if (this._disposed) return

    const keyCode = keyCodeFromKeyboardEvent(event)
    const mods = this._extractModifiers(event)

    // 更新修饰键状态
    if (
      keyCode === KeyCode.LSHIFT || keyCode === KeyCode.RSHIFT ||
      keyCode === KeyCode.LALT || keyCode === KeyCode.RALT ||
      keyCode === KeyCode.LCTRL || keyCode === KeyCode.RCTRL ||
      keyCode === KeyCode.LGUI || keyCode === KeyCode.RGUI
    ) {
      const prevMods = this._modifiersState
      this._modifiersState = mods
      if (prevMods !== mods) {
        this._handler.modifierKeys(mods)
      }
    }

    // 重置按键重复计数
    this._keyRepeatCounts.delete(keyCode)

    const keyInput: KeyInput = {
      event: KeyInputEvent.Up,
      key: keyCode,
      modifiers: mods,
      multiTapCount: 0,
      unicodeChar: '',
      isRepeat: false,
    }

    this._handler.onKeyInput(keyInput)
    event.preventDefault()
  }

  // -----------------------------------------------------------------------
  // 指针/鼠标事件处理
  // -----------------------------------------------------------------------

  private _handlePointerDown(event: PointerEvent): void {
    if (this._disposed) return

    const pos = this._updatePointerPosition(event)
    const mods = this._extractModifiers(event)
    const button = this._pointerButtonToMouseButton(event.button)
    const multiTap = this._updateMultiTapCount(pos.x, pos.y, event.timeStamp)

    const mouseInput: MouseInput = {
      event: MouseInputEvent.Down,
      button,
      location: pos,
      delta: { x: 0, y: 0 },
      modifiers: mods,
      multiTapCount: multiTap,
    }

    this._handler.onMouseInput(mouseInput)
    event.preventDefault()
  }

  private _handlePointerMove(event: PointerEvent): void {
    if (this._disposed) return

    const prevPos = this._mousePosition
    const pos = this._updatePointerPosition(event)
    const mods = this._extractModifiers(event)
    const buttons = this._extractMouseButtons(event)

    const mouseInput: MouseInput = {
      event: MouseInputEvent.Move,
      button: buttons, // 移动事件中携带当前按下的所有按钮
      location: pos,
      delta: {
        x: pos.x - prevPos.x,
        y: pos.y - prevPos.y,
      },
      modifiers: mods,
      multiTapCount: 0,
    }

    this._handler.onMouseInput(mouseInput)
    // 注意: 不调用 preventDefault() 在 pointermove 上以保持性能
  }

  private _handlePointerUp(event: PointerEvent): void {
    if (this._disposed) return

    const pos = this._updatePointerPosition(event)
    const mods = this._extractModifiers(event)
    const button = this._pointerButtonToMouseButton(event.button)

    const mouseInput: MouseInput = {
      event: MouseInputEvent.Up,
      button,
      location: pos,
      delta: { x: 0, y: 0 },
      modifiers: mods,
      multiTapCount: 0,
    }

    this._handler.onMouseInput(mouseInput)
    event.preventDefault()
  }

  // -----------------------------------------------------------------------
  // 滚轮事件处理
  // -----------------------------------------------------------------------

  private _handleWheel(event: WheelEvent): void {
    if (this._disposed) return

    const pos = this._mousePosition
    const mods = this._extractModifiers(event)

    // 在浏览器中，滚轮事件有三个轴: deltaX (水平), deltaY (垂直), deltaZ (无支持)
    // 以 deltaY 为主要滚动量; deltaX 用于横向滚动支持
    const mouseInput: MouseInput = {
      event: MouseInputEvent.Scroll,
      button: MouseButton.None,
      location: pos,
      delta: {
        x: event.deltaX,
        y: event.deltaY,
      },
      modifiers: mods,
      multiTapCount: 0,
    }

    this._handler.onMouseInput(mouseInput)

    // 阻止页面滚动 (必须使用非 passive 监听器)
    event.preventDefault()
  }

  // -----------------------------------------------------------------------
  // 辅助方法
  // -----------------------------------------------------------------------

  /** 更新内部指针位置并返回新位置 (canvas-relative 像素坐标)。 */
  private _updatePointerPosition(event: PointerEvent): { x: number; y: number } {
    // 优先使用 event.offsetX/Y (浏览器原生元素相对坐标)
    // 如果 offsetX/Y 不可用 (如测试环境), 使用 clientX/Y 减去元素边界
    const hasOffset = typeof event.offsetX === 'number' && (event.offsetX !== 0 || event.offsetY !== 0)
    if (hasOffset) {
      this._mousePosition = { x: event.offsetX, y: event.offsetY }
    } else if (this._attachedElement) {
      const rect = this._attachedElement.getBoundingClientRect()
      this._mousePosition = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }
    } else {
      this._mousePosition = { x: event.clientX, y: event.clientY }
    }
    return this._mousePosition
  }
}
