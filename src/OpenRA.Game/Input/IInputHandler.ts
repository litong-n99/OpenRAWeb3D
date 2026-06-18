/**
 * IInputHandler.ts — 输入处理接口与输入事件类型定义
 * OpenRA 对照: OpenRA.Game/Input/IInputHandler.cs (84 lines)
 *
 * 核心范式转换:
 * - C# record struct MouseInput (int2 Location/Delta) → TS interface with {x,y} objects
 * - C# [Flags] Modifiers enum → TS numeric bit flags (shift/alt/ctrl/meta)
 * - C# [Flags] MouseButton enum → TS numeric bit flags (Left/Right/Middle)
 * - C# SDL2 SDL_Event polling → 浏览器 DOM 事件 (KeyEvent/PointerEvent)
 * - 所有坐标在像素空间 (window-relative), 不是 NDC; 适配层负责转换
 */

// ---------------------------------------------------------------------------
// MouseInputEvent enum (对应 OpenRA MouseInputEvent 枚举)
// ---------------------------------------------------------------------------

/** 鼠标输入事件类型。
 *
 * OpenRA 对照: MouseInputEvent enum { Down, Move, Up, Scroll }
 */
export const MouseInputEvent = {
  Down: 0,
  Move: 1,
  Up: 2,
  Scroll: 3,
} as const

export type MouseInputEvent =
  (typeof MouseInputEvent)[keyof typeof MouseInputEvent]

// ---------------------------------------------------------------------------
// MouseButton flags enum (对应 OpenRA [Flags] MouseButton 枚举)
// ---------------------------------------------------------------------------

/** 鼠标按钮位标志枚举。
 *
 * OpenRA 对照: [Flags] MouseButton { None = 0, Left = 1, Right = 2, Middle = 4 }
 *
 * 扩展了 X1 (8) 和 X2 (16) 以支持浏览器侧键。
 */
export const MouseButton = {
  None: 0,
  Left: 1,
  Middle: 2,
  Right: 4,
  X1: 8,
  X2: 16,
} as const

export type MouseButton = number

// ---------------------------------------------------------------------------
// Modifiers flags enum (对应 OpenRA [Flags] Modifiers 枚举)
// ---------------------------------------------------------------------------

/** 键盘修饰键位标志枚举。
 *
 * OpenRA 对照: [Flags] Modifiers { None = 0, Shift = 1, Alt = 2, Ctrl = 4, Meta = 8 }
 */
export const Modifiers = {
  None: 0,
  Shift: 1,
  Alt: 2,
  Ctrl: 4,
  Meta: 8,
} as const

export type Modifiers = number

// @todo : 实现 ModifiersExts.DisplayString(Modifiers m)
// OpenRA 对照: ModifiersExts.DisplayString() + ModifierFluentKeys
// 当 FluentProvider/本地化系统迁移完成后，添加从修饰键位标志到
// 人类可读字符串 (支持 i18n) 的转换。

// ---------------------------------------------------------------------------
// MouseInput 接口 (对应 OpenRA MouseInput record struct)
// ---------------------------------------------------------------------------

/** 鼠标输入事件数据。
 *
 * OpenRA 对照: record struct MouseInput(MouseInputEvent Event, MouseButton Button,
 *   int2 Location, int2 Delta, Modifiers Modifiers, int MultiTapCount)
 */
export interface MouseInput {
  /** 事件类型: Down/Move/Up/Scroll */
  readonly event: MouseInputEvent

  /** 按下的鼠标按钮位标志 (Move 事件中 button 位可能为 None) */
  readonly button: MouseButton

  /** 鼠标位置 (像素坐标，窗口相对) */
  readonly location: { readonly x: number; readonly y: number }

  /** 鼠标移动增量 (Move: dx/dy, Scroll: scroll delta) */
  readonly delta: { readonly x: number; readonly y: number }

  /** 当前按下的修饰键位标志 */
  readonly modifiers: Modifiers

  /** 多点触控计数 (双击/三击等) */
  readonly multiTapCount: number
}

// ---------------------------------------------------------------------------
// KeyInputEvent enum (对应 OpenRA KeyInputEvent 枚举)
// ---------------------------------------------------------------------------

/** 键盘输入事件类型。
 *
 * OpenRA 对照: KeyInputEvent enum { Down, Up }
 */
export const KeyInputEvent = {
  Down: 0,
  Up: 1,
} as const

export type KeyInputEvent =
  (typeof KeyInputEvent)[keyof typeof KeyInputEvent]

// ---------------------------------------------------------------------------
// KeyInput 接口 (对应 OpenRA KeyInput struct)
// ---------------------------------------------------------------------------

/** 键盘输入事件数据。
 *
 * OpenRA 对照: struct KeyInput { KeyInputEvent Event; Keycode Key;
 *   Modifiers Modifiers; int MultiTapCount; char UnicodeChar; bool IsRepeat; }
 */
export interface KeyInput {
  /** 事件类型: Down/Up */
  readonly event: KeyInputEvent

  /** 按键代码 (映射自 SDL Keycode) */
  readonly key: number

  /** 当前按下的修饰键位标志 */
  readonly modifiers: Modifiers

  /** 多点触控计数 (重复按键计数) */
  readonly multiTapCount: number

  /** Unicode 字符值 (0 表示无字符) */
  readonly unicodeChar: string

  /** 是否为自动重复产生的按键事件 */
  readonly isRepeat: boolean
}

// ---------------------------------------------------------------------------
// IInputHandler 接口 (对应 OpenRA IInputHandler 接口)
// ---------------------------------------------------------------------------

/** 输入处理器接口。所有输入事件通过此接口路由到游戏逻辑。
 *
 * OpenRA 对照: IInputHandler interface
 *
 * 实现类:
 * - NullInputHandler: 空操作实现 (无头模式/重放/专用服务器)
 * - DefaultInputHandler: 完整输入事件处理 (交互式游戏)
 */
export interface IInputHandler {
  /** 修饰键状态变更回调。
   *
   * OpenRA 对照: void IInputHandler.ModifierKeys(Modifiers mods)
   */
  modifierKeys(mods: Modifiers): void

  /** 键盘按键事件回调。
   *
   * OpenRA 对照: void IInputHandler.OnKeyInput(KeyInput input)
   */
  onKeyInput(input: KeyInput): void

  /** 鼠标输入事件回调。
   *
   * OpenRA 对照: void IInputHandler.OnMouseInput(MouseInput input)
   */
  onMouseInput(input: MouseInput): void

  /** 文本输入事件回调 (用于 IME 输入)。
   *
   * OpenRA 对照: void IInputHandler.OnTextInput(string text)
   */
  onTextInput(text: string): void
}
