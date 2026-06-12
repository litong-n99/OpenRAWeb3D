/**
 * HotkeyReference.ts — 热键引用与热键值类型
 * OpenRA 对照: OpenRA.Game/Input/HotkeyReference.cs (46 lines)
 *              OpenRA.Game/Input/Hotkey.cs (104 lines)
 *
 * 核心范式转换:
 * - C# Hotkey readonly struct (Keycode, Modifiers) → TS Hotkey class (key, modifiers)
 * - C# Hotkey.TryParse(string) → TS Hotkey.tryParse(string)
 * - C# Hotkey.FromKeyInput(KeyInput) → TS Hotkey.fromKeyInput(KeyInput)
 * - C# Hotkey.DisplayString() + ModifiersExts → TS Hotkey.displayString() + modsDisplayString
 * - C# HotkeyReference(Func<Hotkey> getValue) → TS HotkeyReference(getValue)
 * - C# KeycodeExts.DisplayString + ModifiersExts.DisplayString → 内联映射表
 *
 * 注意:
 * - Modifiers 是数字位标志，ModifiersExts 提供显示名称转换。
 *   OpenRA 中本地化通过 Fluent 系统实现，此迁移使用硬编码英文名称。
 *   TODO: Fluent 本地化迁移完成后支持 i18n。
 * - OpenRA 的 HotkeyReference 通过 internal 构造函数注入 Func<Hotkey>，
 *   HotkeyManager.GetHotkeyReference(name) 创建命名热键的动态查找引用。
 *   TODO-7.B.2.1: HotkeyManager 迁移后，ViewportControllerWidget 使用命名热键
 *   引用代替硬编码键值。
 */

import { KeyCode, keyName } from './Keycode'
import { Modifiers } from './IInputHandler'
import type { KeyInput } from './IInputHandler'

// ---------------------------------------------------------------------------
// ModifiersExts — 修饰键显示名称辅助
// ---------------------------------------------------------------------------

/** 修饰键位标志的人类可读显示名称。
 *
 * OpenRA 对照: ModifiersExts.DisplayString(Modifiers m)
 */
export function modsDisplayString(mods: Modifiers): string {
  if (mods === Modifiers.None) return ''
  if (mods === Modifiers.Shift) return 'Shift'
  if (mods === Modifiers.Alt) return 'Alt'
  if (mods === Modifiers.Ctrl) return 'Ctrl'
  if (mods === Modifiers.Meta) return 'Meta'

  // 复合修饰键: 按 Shift > Alt > Ctrl > Meta 顺序连接
  const parts: string[] = []
  if (mods & Modifiers.Shift) parts.push('Shift')
  if (mods & Modifiers.Alt) parts.push('Alt')
  if (mods & Modifiers.Ctrl) parts.push('Ctrl')
  if (mods & Modifiers.Meta) parts.push('Meta')
  return parts.join(' + ')
}

/**
 * 检查修饰键位标志中是否包含指定的修饰键。
 *
 * OpenRA 对照: ModifiersExts.HasModifier(Modifiers mods, Modifiers m)
 */
export function modsHasModifier(mods: Modifiers, modifier: Modifiers): boolean {
  // OpenRA: (self & m) == m
  return (mods & modifier) === modifier
}

// ---------------------------------------------------------------------------
// Hotkey — 热键值类型 (对应 OpenRA readonly struct Hotkey)
// ---------------------------------------------------------------------------

/**
 * 热键值: 按键 + 修饰键组合。
 *
 * OpenRA 对照: readonly struct Hotkey : IEquatable<Hotkey>
 *
 * 注意: OpenRA 中 Hotkey 是值类型 (readonly struct)，实现 IEquatable<Hotkey>。
 * TypeScript 中没有值类型，使用 class 实现，提供 equals() 方法进行相等性比较。
 */
export class Hotkey {
  /** 无效热键: KeyCode.UNKNOWN + Modifiers.None。
   *
   * OpenRA 对照: Hotkey.Invalid = new Hotkey(Keycode.UNKNOWN, Modifiers.None)
   */
  static readonly Invalid = new Hotkey(KeyCode.UNKNOWN, Modifiers.None)

  /** SDL 键盘码。OpenRA 对照: public readonly Keycode Key */
  readonly key: KeyCode
  /** 修饰键位标志。OpenRA 对照: public readonly Modifiers Modifiers */
  readonly modifiers: Modifiers

  /** 构造热键值。
   *
   * OpenRA 对照: public Hotkey(Keycode virtKey, Modifiers mod)
   */
  constructor(key: KeyCode, modifiers: Modifiers) {
    this.key = key
    this.modifiers = modifiers
  }

  /** 此热键是否有效 (key 不是 UNKNOWN)。
   *
   * OpenRA 对照: public bool IsValid()
   */
  isValid(): boolean {
    return this.key !== KeyCode.UNKNOWN
  }

  /** 判断与另一个热键是否相等。
   *
   * OpenRA 对照: operator == (Unknown keys are never equal;
   *   otherwise Key == Key && Modifiers == Modifiers)
   */
  equals(other: Hotkey): boolean {
    if (this.key === KeyCode.UNKNOWN) return false
    return this.key === other.key && this.modifiers === other.modifiers
  }

  /** 尝试从字符串解析热键。
   *
   * 格式: "KeycodeName [ModifierName]"
   * 示例: "PageUp Ctrl" "A Shift" "Space"
   *
   * OpenRA 对照: public static bool TryParse(string s, out Hotkey result)
   *
   * @param s — 待解析的热键字符串
   * @returns { success: true, value: Hotkey } 或 { success: false, value: Hotkey.Invalid }
   */
  static tryParse(
    s: string | null,
  ): { success: boolean; value: Hotkey } {
    if (!s || s.length === 0) {
      return { success: false, value: Hotkey.Invalid }
    }

    const parts = s.split(' ')
    if (parts.length === 0 || parts[0]!.length === 0) {
      return { success: false, value: Hotkey.Invalid }
    }

    // 尝试将第一部分解析为 KeyCode
    let key: KeyCode = KeyCode.UNKNOWN
    // 遍历 KeyCode 查找匹配名称的键
    const keyName = parts[0]!
    for (const [name, code] of Object.entries(KeyCode)) {
      // 尝试名称匹配 (不区分大小写)
      if (name.toUpperCase() === keyName.toUpperCase()) {
        key = code as KeyCode
        break
      }
      // 也尝试显示名称匹配
      if (keyName.toLowerCase() === name.toLowerCase()) {
        key = code as KeyCode
        break
      }
    }

    if (key === KeyCode.UNKNOWN) {
      // 尝试数字解析 (SDL 键码数字)
      const numeric = parseInt(keyName, 10)
      if (!isNaN(numeric)) {
        key = numeric as KeyCode
      }
    }

    if (key === KeyCode.UNKNOWN || key >= KeyCode.MOUSE4) {
      // Try matching by display name
      for (const [code, display] of Object.entries(HOTKEY_DISPLAY_NAMES) as unknown as [string, string][]) {
        if (display.toLowerCase() === keyName.toLowerCase()) {
          key = parseInt(code) as KeyCode
          break
        }
      }
    }

    if (key === KeyCode.UNKNOWN) {
      return { success: false, value: Hotkey.Invalid }
    }

    // 解析修饰键
    let mods: Modifiers = Modifiers.None
    if (parts.length >= 2 && parts[1]!.length > 0) {
      const modStr = parts[1]!
      for (const mod of modStr.split(',')) {
        const trimmed = mod.trim()
        if (trimmed === 'Shift') mods |= Modifiers.Shift
        else if (trimmed === 'Alt') mods |= Modifiers.Alt
        else if (trimmed === 'Ctrl') mods |= Modifiers.Ctrl
        else if (trimmed === 'Meta') mods |= Modifiers.Meta
      }
    }

    return { success: true, value: new Hotkey(key, mods) }
  }

  /** 从键盘输入事件创建热键。
   *
   * OpenRA 对照: public static Hotkey FromKeyInput(KeyInput ki)
   */
  static fromKeyInput(ki: KeyInput): Hotkey {
    return new Hotkey(ki.key, ki.modifiers)
  }

  /** 返回热键的字符串表示。
   *
   * OpenRA 对照: public override string ToString() => $"{Key} {Modifiers:F}"
   */
  toString(): string {
    const keyStr = keyName(this.key)
    const modsStr = modsDisplayString(this.modifiers)
    if (modsStr.length > 0) return `${keyStr} ${modsStr}`
    return keyStr
  }

  /** 人类可读的热键显示字符串，修饰键在前。
   *
   * OpenRA 对照: public string DisplayString()
   *
   * 例如: "Ctrl + Shift + A" "Page Up"
   */
  displayString(): string {
    const keyStr = keyName(this.key)
    const parts: string[] = []

    if (modsHasModifier(this.modifiers, Modifiers.Shift))
      parts.push('Shift')
    if (modsHasModifier(this.modifiers, Modifiers.Alt))
      parts.push('Alt')
    if (modsHasModifier(this.modifiers, Modifiers.Ctrl))
      parts.push('Ctrl')
    if (modsHasModifier(this.modifiers, Modifiers.Meta))
      parts.push('Meta')

    if (parts.length > 0) return `${parts.join(' + ')} + ${keyStr}`
    return keyStr
  }
}

// ---------------------------------------------------------------------------
// KeyCode → 显示名称映射表 (热键解析用回退)
// ---------------------------------------------------------------------------

/**
 * KeyCode 枚举成员名称 → 人类可读显示名称。
 *
 * 用于 tryParse 中的按显示名称反向查找。
 */
const HOTKEY_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  [`${KeyCode.RETURN}`]: 'Enter',
  [`${KeyCode.ESCAPE}`]: 'Escape',
  [`${KeyCode.BACKSPACE}`]: 'Backspace',
  [`${KeyCode.TAB}`]: 'Tab',
  [`${KeyCode.SPACE}`]: 'Space',
  [`${KeyCode.F1}`]: 'F1',
  [`${KeyCode.F2}`]: 'F2',
  [`${KeyCode.F3}`]: 'F3',
  [`${KeyCode.F4}`]: 'F4',
  [`${KeyCode.F5}`]: 'F5',
  [`${KeyCode.F6}`]: 'F6',
  [`${KeyCode.F7}`]: 'F7',
  [`${KeyCode.F8}`]: 'F8',
  [`${KeyCode.F9}`]: 'F9',
  [`${KeyCode.F10}`]: 'F10',
  [`${KeyCode.F11}`]: 'F11',
  [`${KeyCode.F12}`]: 'F12',
  [`${KeyCode.PAGEUP}`]: 'Page Up',
  [`${KeyCode.PAGEDOWN}`]: 'Page Down',
  [`${KeyCode.HOME}`]: 'Home',
  [`${KeyCode.END}`]: 'End',
  [`${KeyCode.INSERT}`]: 'Insert',
  [`${KeyCode.DELETE}`]: 'Delete',
  [`${KeyCode.UP}`]: 'Up',
  [`${KeyCode.DOWN}`]: 'Down',
  [`${KeyCode.LEFT}`]: 'Left',
  [`${KeyCode.RIGHT}`]: 'Right',
  [`${KeyCode.PRINTSCREEN}`]: 'Print Screen',
  [`${KeyCode.SCROLLLOCK}`]: 'Scroll Lock',
  [`${KeyCode.PAUSE}`]: 'Pause',
  [`${KeyCode.CAPSLOCK}`]: 'Caps Lock',
  [`${KeyCode.NUMLOCKCLEAR}`]: 'Num Lock',
}

// ---------------------------------------------------------------------------
// HotkeyReference — 热键引用 (对应 OpenRA HotkeyReference class)
// ---------------------------------------------------------------------------

/**
 * 热键引用: 对命名热键 (定义于游戏设置) 或静态分配热键的引用。
 *
 * OpenRA 对照: class HotkeyReference
 *
 * 设计:
 * - OpenRA 通过 internal 构造注入 Func<Hotkey> 委托，支持运行时查找
 *   (HotkeyManager.[name] → live lookup in mutable dictionary)
 * - 此 TS 实现支持两种模式:
 *   1. 静态热键: 直接传入 Hotkey 实例 (用于默认热键或测试)
 *   2. 动态热键: 传入 getter 函数 () => Hotkey (用于 HotkeyManager 查找)
 * - HotkeyReference.Invalid 始终返回 Hotkey.Invalid
 *
 * TODO-7.B.2.1: HotkeyManager 迁移后，ViewportControllerWidget 通过
 * HotkeyManager 获取命名热键引用 (如 "ViewportZoomIn", "ScrollUp" 等)。
 */
export class HotkeyReference {
  /** 无效热键引用: 始终返回 Hotkey.Invalid。
   *
   * OpenRA 对照: static readonly Func<Hotkey> Invalid
   */
  static readonly Invalid = new HotkeyReference()

  private readonly getValueFn: () => Hotkey

  /** 默认构造: 创建无效热键引用 (始终返回 Hotkey.Invalid)。
   *
   * OpenRA 对照: public HotkeyReference()
   */
  constructor();

  /** 使用自定义 getter 构造。
   *
   * OpenRA 对照: internal HotkeyReference(Func<Hotkey> getValue)
   */
  constructor(getValue: () => Hotkey);

  /** 使用静态热键值构造 (更符合 TS 惯用风格)。
   *
   * @param hotkey — 固定的热键值
   */
  constructor(hotkey: Hotkey);

  // 实现
  constructor(arg?: (() => Hotkey) | Hotkey) {
    if (!arg) {
      this.getValueFn = () => Hotkey.Invalid
    } else if (arg instanceof Hotkey) {
      const captured = arg
      this.getValueFn = () => captured
    } else {
      this.getValueFn = arg
    }
  }

  /** 获取当前热键值。
   *
   * 对于动态热键 (HotkeyManager 命名热键)，此函数每次调用时查询最新值。
   * 对于静态热键，返回固定值。
   *
   * OpenRA 对照: public Hotkey GetValue()
   */
  getValue(): Hotkey {
    return this.getValueFn()
  }

  /** 检查给定的键盘输入是否激活此热键。
   *
   * 比较当前热键值与输入的 key 和 modifiers。
   *
   * OpenRA 对照: public bool IsActivatedBy(KeyInput e)
   *
   * @param e — 键盘输入事件
   * @returns 如果输入匹配当前热键值则返回 true
   */
  isActivatedBy(e: KeyInput): boolean {
    const currentValue = this.getValueFn()
    return currentValue.key === e.key && currentValue.modifiers === e.modifiers
  }
}
