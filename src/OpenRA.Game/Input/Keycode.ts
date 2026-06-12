/**
 * Keycode.ts — SDL 键盘码到浏览器 KeyboardEvent.code 的映射表
 * OpenRA 对照: OpenRA.Game/Input/Keycode.cs (513 lines)
 *
 * 核心范式转换:
 * - C# SDL 2.0.1 Keycode enum (~230 members) → TS KeyCode enum (数值匹配 SDL)
 * - C# 使用 SDL 键码值直接分派 → 浏览器使用 KeyboardEvent.code 字符串分派
 * - 提供双向映射: SDL 数值 → KeyCode, KeyboardEvent.code → KeyCode
 * - 保留 SDL 数值以兼容 OpenRA 热键配置文件 (settings.yaml)
 * - MOUSE4 (283|1<<30) 和 MOUSE5 (284|1<<30) 保留在枚举中
 *
 * 注意:
 * - OpenRA 中的枚举值使用 | (1 << 30) 标志 (~1073741824)。对于按键类别别，
 *   这是 SDL 内部的 SCANCODE_MASK (1<<30)。
 * - 在 TypeScript 中保留这些原始数值以确保配置兼容性。
 * - 部分 SDL 按键在浏览器中没有对应 KeyboardEvent.code (如 PRINTSCREEN, PAUSE 等)。
 *   这些按键的 fromKeyboardEvent 将返回 UNKNOWN。
 */

// ---------------------------------------------------------------------------
// KeyCode enum (对应 OpenRA Keycode 枚举: SDL 2.0.1 + MOUSE4/MOUSE5)
// ---------------------------------------------------------------------------

/** SDL 键盘码枚举 — 使用与 OpenRA 完全相同的数值。
 *
 * OpenRA 对照: enum Keycode (SDL 2.0.1 键码, duplicated from SDL)
 *
 * 枚举成员分为三类:
 * - 无 SDL SCANCODE_MASK 标志的常规键 (数值 < 1<<30):
 *   RETURN, ESCAPE, BACKSPACE, TAB, SPACE, 标点符号键, 字母数字键, DELETE
 * - 带 SDL SCANCODE_MASK 标志的功能键和扩展键 (数值 | (1<<30)):
 *   F1-F24, 方向键, 小键盘, 修饰键, 多媒体键等
 * - 扩展鼠标按钮: MOUSE4, MOUSE5
 */
export const KeyCode = {
  // ---- 无 SCANCODE_MASK 标志的键 ----
  UNKNOWN: 0,
  RETURN: 13, // '\r'
  ESCAPE: 27,
  BACKSPACE: 8, // '\b'
  TAB: 9, // '\t'
  SPACE: 32, // ' '
  EXCLAIM: 33, // '!'
  QUOTEDBL: 34, // '"'
  HASH: 35, // '#'
  DOLLAR: 36, // '$'
  PERCENT: 37, // '%'
  AMPERSAND: 38, // '&'
  QUOTE: 39, // '\''
  LEFTPAREN: 40, // '('
  RIGHTPAREN: 41, // ')'
  ASTERISK: 42, // '*'
  PLUS: 43, // '+'
  COMMA: 44, // ','
  MINUS: 45, // '-'
  PERIOD: 46, // '.'
  SLASH: 47, // '/'
  NUMBER_0: 48, // '0'
  NUMBER_1: 49, // '1'
  NUMBER_2: 50, // '2'
  NUMBER_3: 51, // '3'
  NUMBER_4: 52, // '4'
  NUMBER_5: 53, // '5'
  NUMBER_6: 54, // '6'
  NUMBER_7: 55, // '7'
  NUMBER_8: 56, // '8'
  NUMBER_9: 57, // '9'
  COLON: 58, // ':'
  SEMICOLON: 59, // ';'
  LESS: 60, // '<'
  EQUALS: 61, // '='
  GREATER: 62, // '>'
  QUESTION: 63, // '?'
  AT: 64, // '@'

  // ---- 字母键 (a-z, ASCII) ----
  A: 97, // 'a'
  B: 98, // 'b'
  C: 99, // 'c'
  D: 100, // 'd'
  E: 101, // 'e'
  F: 102, // 'f'
  G: 103, // 'g'
  H: 104, // 'h'
  I: 105, // 'i'
  J: 106, // 'j'
  K: 107, // 'k'
  L: 108, // 'l'
  M: 109, // 'm'
  N: 110, // 'n'
  O: 111, // 'o'
  P: 112, // 'p'
  Q: 113, // 'q'
  R: 114, // 'r'
  S: 115, // 's'
  T: 116, // 't'
  U: 117, // 'u'
  V: 118, // 'v'
  W: 119, // 'w'
  X: 120, // 'x'
  Y: 121, // 'y'
  Z: 122, // 'z'

  // ---- 方括号和特殊符号 ----
  LEFTBRACKET: 91, // '['
  BACKSLASH: 92, // '\\'
  RIGHTBRACKET: 93, // ']'
  CARET: 94, // '^'
  UNDERSCORE: 95, // '_'
  BACKQUOTE: 96, // '`'
  DELETE: 127,

  // ---- SCANCODE_MASK (1 << 30) 标志的键 ----
  // SDL_SCANCODE_MASK = 1 << 30 = 1073741824
  // 以下键值 = (原始 SDL 扫描码) | (1 << 30)

  CAPSLOCK:      (57 | (1 << 30)),
  F1:            (58 | (1 << 30)),
  F2:            (59 | (1 << 30)),
  F3:            (60 | (1 << 30)),
  F4:            (61 | (1 << 30)),
  F5:            (62 | (1 << 30)),
  F6:            (63 | (1 << 30)),
  F7:            (64 | (1 << 30)),
  F8:            (65 | (1 << 30)),
  F9:            (66 | (1 << 30)),
  F10:           (67 | (1 << 30)),
  F11:           (68 | (1 << 30)),
  F12:           (69 | (1 << 30)),
  PRINTSCREEN:   (70 | (1 << 30)),
  SCROLLLOCK:    (71 | (1 << 30)),
  PAUSE:         (72 | (1 << 30)),
  INSERT:        (73 | (1 << 30)),
  HOME:          (74 | (1 << 30)),
  PAGEUP:        (75 | (1 << 30)),
  END:           (77 | (1 << 30)),
  PAGEDOWN:      (78 | (1 << 30)),
  RIGHT:         (79 | (1 << 30)),
  LEFT:          (80 | (1 << 30)),
  DOWN:          (81 | (1 << 30)),
  UP:            (82 | (1 << 30)),
  NUMLOCKCLEAR:  (83 | (1 << 30)),

  // ---- 小键盘键 ----
  KP_DIVIDE:     (84 | (1 << 30)),
  KP_MULTIPLY:   (85 | (1 << 30)),
  KP_MINUS:      (86 | (1 << 30)),
  KP_PLUS:       (87 | (1 << 30)),
  KP_ENTER:      (88 | (1 << 30)),
  KP_1:          (89 | (1 << 30)),
  KP_2:          (90 | (1 << 30)),
  KP_3:          (91 | (1 << 30)),
  KP_4:          (92 | (1 << 30)),
  KP_5:          (93 | (1 << 30)),
  KP_6:          (94 | (1 << 30)),
  KP_7:          (95 | (1 << 30)),
  KP_8:          (96 | (1 << 30)),
  KP_9:          (97 | (1 << 30)),
  KP_0:          (98 | (1 << 30)),
  KP_PERIOD:     (99 | (1 << 30)),

  // ---- 系统键 ----
  APPLICATION:   (101 | (1 << 30)),
  POWER:         (102 | (1 << 30)),
  KP_EQUALS:     (103 | (1 << 30)),
  F13:           (104 | (1 << 30)),
  F14:           (105 | (1 << 30)),
  F15:           (106 | (1 << 30)),
  F16:           (107 | (1 << 30)),
  F17:           (108 | (1 << 30)),
  F18:           (109 | (1 << 30)),
  F19:           (110 | (1 << 30)),
  F20:           (111 | (1 << 30)),
  F21:           (112 | (1 << 30)),
  F22:           (113 | (1 << 30)),
  F23:           (114 | (1 << 30)),
  F24:           (115 | (1 << 30)),

  // ---- 编辑/命令键 ----
  EXECUTE:       (116 | (1 << 30)),
  HELP:          (117 | (1 << 30)),
  MENU:          (118 | (1 << 30)),
  SELECT:        (119 | (1 << 30)),
  STOP:          (120 | (1 << 30)),
  AGAIN:         (121 | (1 << 30)),
  UNDO:          (122 | (1 << 30)),
  CUT:           (123 | (1 << 30)),
  COPY:          (124 | (1 << 30)),
  PASTE:         (125 | (1 << 30)),
  FIND:          (126 | (1 << 30)),
  MUTE:          (127 | (1 << 30)),
  VOLUMEUP:      (128 | (1 << 30)),
  VOLUMEDOWN:    (129 | (1 << 30)),

  // ---- 扩展小键盘 (非标准) ----
  KP_COMMA:        (133 | (1 << 30)),
  KP_EQUALSAS400:  (134 | (1 << 30)),
  ALTERASE:        (153 | (1 << 30)),
  SYSREQ:          (154 | (1 << 30)),
  CANCEL:          (155 | (1 << 30)),
  CLEAR:           (156 | (1 << 30)),
  PRIOR:           (157 | (1 << 30)),
  RETURN2:         (158 | (1 << 30)),
  SEPARATOR:       (159 | (1 << 30)),
  OUT:             (160 | (1 << 30)),
  OPER:            (161 | (1 << 30)),
  CLEARAGAIN:      (162 | (1 << 30)),
  CRSEL:           (163 | (1 << 30)),
  EXSEL:           (164 | (1 << 30)),
  KP_00:           (176 | (1 << 30)),
  KP_000:          (177 | (1 << 30)),
  THOUSANDSSEPARATOR: (178 | (1 << 30)),
  DECIMALSEPARATOR:   (179 | (1 << 30)),
  CURRENCYUNIT:       (180 | (1 << 30)),
  CURRENCYSUBUNIT:    (181 | (1 << 30)),
  KP_LEFTPAREN:   (182 | (1 << 30)),
  KP_RIGHTPAREN:  (183 | (1 << 30)),
  KP_LEFTBRACE:   (184 | (1 << 30)),
  KP_RIGHTBRACE:  (185 | (1 << 30)),
  KP_TAB:         (186 | (1 << 30)),
  KP_BACKSPACE:   (187 | (1 << 30)),
  KP_A:           (188 | (1 << 30)),
  KP_B:           (189 | (1 << 30)),
  KP_C:           (190 | (1 << 30)),
  KP_D:           (191 | (1 << 30)),
  KP_E:           (192 | (1 << 30)),
  KP_F:           (193 | (1 << 30)),
  KP_XOR:         (194 | (1 << 30)),
  KP_POWER:       (195 | (1 << 30)),
  KP_PERCENT:     (196 | (1 << 30)),
  KP_LESS:        (197 | (1 << 30)),
  KP_GREATER:     (198 | (1 << 30)),
  KP_AMPERSAND:   (199 | (1 << 30)),
  KP_DBLAMPERSAND: (200 | (1 << 30)),
  KP_VERTICALBAR:  (201 | (1 << 30)),
  KP_DBLVERTICALBAR: (202 | (1 << 30)),
  KP_COLON:       (203 | (1 << 30)),
  KP_HASH:        (204 | (1 << 30)),
  KP_SPACE:       (205 | (1 << 30)),
  KP_AT:          (206 | (1 << 30)),
  KP_EXCLAM:      (207 | (1 << 30)),
  KP_MEMSTORE:    (208 | (1 << 30)),
  KP_MEMRECALL:   (209 | (1 << 30)),
  KP_MEMCLEAR:    (210 | (1 << 30)),
  KP_MEMADD:      (211 | (1 << 30)),
  KP_MEMSUBTRACT: (212 | (1 << 30)),
  KP_MEMMULTIPLY: (213 | (1 << 30)),
  KP_MEMDIVIDE:   (214 | (1 << 30)),
  KP_PLUSMINUS:   (215 | (1 << 30)),
  KP_CLEAR:       (216 | (1 << 30)),
  KP_CLEARENTRY:  (217 | (1 << 30)),
  KP_BINARY:      (218 | (1 << 30)),
  KP_OCTAL:       (219 | (1 << 30)),
  KP_DECIMAL:     (220 | (1 << 30)),
  KP_HEXADECIMAL: (221 | (1 << 30)),

  // ---- 左右修饰键 ----
  LCTRL:   (224 | (1 << 30)),
  LSHIFT:  (225 | (1 << 30)),
  LALT:    (226 | (1 << 30)),
  LGUI:    (227 | (1 << 30)),
  RCTRL:   (228 | (1 << 30)),
  RSHIFT:  (229 | (1 << 30)),
  RALT:    (230 | (1 << 30)),
  RGUI:    (231 | (1 << 30)),

  // ---- 模式/多媒体键 ----
  MODE:           (257 | (1 << 30)),
  AUDIONEXT:      (258 | (1 << 30)),
  AUDIOPREV:      (259 | (1 << 30)),
  AUDIOSTOP:      (260 | (1 << 30)),
  AUDIOPLAY:      (261 | (1 << 30)),
  AUDIOMUTE:      (262 | (1 << 30)),
  MEDIASELECT:    (263 | (1 << 30)),
  WWW:            (264 | (1 << 30)),
  MAIL:           (265 | (1 << 30)),
  CALCULATOR:     (266 | (1 << 30)),
  COMPUTER:       (267 | (1 << 30)),
  AC_SEARCH:      (268 | (1 << 30)),
  AC_HOME:        (269 | (1 << 30)),
  AC_BACK:        (270 | (1 << 30)),
  AC_FORWARD:     (271 | (1 << 30)),
  AC_STOP:        (272 | (1 << 30)),
  AC_REFRESH:     (273 | (1 << 30)),
  AC_BOOKMARKS:   (274 | (1 << 30)),
  BRIGHTNESSDOWN: (275 | (1 << 30)),
  BRIGHTNESSUP:   (276 | (1 << 30)),
  DISPLAYSWITCH:  (277 | (1 << 30)),
  KBDILLUMTOGGLE: (278 | (1 << 30)),
  KBDILLUMDOWN:   (279 | (1 << 30)),
  KBDILLUMUP:     (280 | (1 << 30)),
  EJECT:          (281 | (1 << 30)),
  SLEEP:          (282 | (1 << 30)),
  MOUSE4:         (283 | (1 << 30)),
  MOUSE5:         (284 | (1 << 30)),
} as const

export type KeyCode = (typeof KeyCode)[keyof typeof KeyCode]

// ---------------------------------------------------------------------------
// KeyboardEvent.code → KeyCode 映射表 (编译时构建，运行时快速查找)
// ---------------------------------------------------------------------------

/**
 * KeyboardEvent.code 字符串 → KeyCode 枚举值的映射表。
 *
 * 此表允许 O(1) 查找，将浏览器标准键码字符串映射到 SDL 键码枚举值。
 * 映射时考虑了美国标准键盘布局。对于非美国键盘布局，部分符号键可能映射错误；
 * 此时回退到 `KeyboardEvent.key` 字符推断。
 */
const CODE_TO_KEYCODE: Readonly<Record<string, KeyCode>> = {
  // ---- 字母键 ----
  KeyA: KeyCode.A,
  KeyB: KeyCode.B,
  KeyC: KeyCode.C,
  KeyD: KeyCode.D,
  KeyE: KeyCode.E,
  KeyF: KeyCode.F,
  KeyG: KeyCode.G,
  KeyH: KeyCode.H,
  KeyI: KeyCode.I,
  KeyJ: KeyCode.J,
  KeyK: KeyCode.K,
  KeyL: KeyCode.L,
  KeyM: KeyCode.M,
  KeyN: KeyCode.N,
  KeyO: KeyCode.O,
  KeyP: KeyCode.P,
  KeyQ: KeyCode.Q,
  KeyR: KeyCode.R,
  KeyS: KeyCode.S,
  KeyT: KeyCode.T,
  KeyU: KeyCode.U,
  KeyV: KeyCode.V,
  KeyW: KeyCode.W,
  KeyX: KeyCode.X,
  KeyY: KeyCode.Y,
  KeyZ: KeyCode.Z,

  // ---- 数字键 ----
  Digit0: KeyCode.NUMBER_0,
  Digit1: KeyCode.NUMBER_1,
  Digit2: KeyCode.NUMBER_2,
  Digit3: KeyCode.NUMBER_3,
  Digit4: KeyCode.NUMBER_4,
  Digit5: KeyCode.NUMBER_5,
  Digit6: KeyCode.NUMBER_6,
  Digit7: KeyCode.NUMBER_7,
  Digit8: KeyCode.NUMBER_8,
  Digit9: KeyCode.NUMBER_9,

  // ---- 功能键 ----
  F1: KeyCode.F1,
  F2: KeyCode.F2,
  F3: KeyCode.F3,
  F4: KeyCode.F4,
  F5: KeyCode.F5,
  F6: KeyCode.F6,
  F7: KeyCode.F7,
  F8: KeyCode.F8,
  F9: KeyCode.F9,
  F10: KeyCode.F10,
  F11: KeyCode.F11,
  F12: KeyCode.F12,
  F13: KeyCode.F13,
  F14: KeyCode.F14,
  F15: KeyCode.F15,
  F16: KeyCode.F16,
  F17: KeyCode.F17,
  F18: KeyCode.F18,
  F19: KeyCode.F19,
  F20: KeyCode.F20,
  F21: KeyCode.F21,
  F22: KeyCode.F22,
  F23: KeyCode.F23,
  F24: KeyCode.F24,

  // ---- 导航键 ----
  ArrowUp: KeyCode.UP,
  ArrowDown: KeyCode.DOWN,
  ArrowLeft: KeyCode.LEFT,
  ArrowRight: KeyCode.RIGHT,

  // ---- 编辑键 ----
  Home: KeyCode.HOME,
  End: KeyCode.END,
  PageUp: KeyCode.PAGEUP,
  PageDown: KeyCode.PAGEDOWN,
  Insert: KeyCode.INSERT,
  Delete: KeyCode.DELETE,

  // ---- 特殊键 ----
  Enter: KeyCode.RETURN,
  Escape: KeyCode.ESCAPE,
  Backspace: KeyCode.BACKSPACE,
  Tab: KeyCode.TAB,
  Space: KeyCode.SPACE,
  CapsLock: KeyCode.CAPSLOCK,
  PrintScreen: KeyCode.PRINTSCREEN,
  ScrollLock: KeyCode.SCROLLLOCK,
  Pause: KeyCode.PAUSE,
  NumLock: KeyCode.NUMLOCKCLEAR,
  ContextMenu: KeyCode.MENU,

  // ---- 修饰键 (左右分别映射) ----
  ShiftLeft: KeyCode.LSHIFT,
  ShiftRight: KeyCode.RSHIFT,
  ControlLeft: KeyCode.LCTRL,
  ControlRight: KeyCode.RCTRL,
  AltLeft: KeyCode.LALT,
  AltRight: KeyCode.RALT,
  MetaLeft: KeyCode.LGUI,
  MetaRight: KeyCode.RGUI,

  // ---- 小键盘 ----
  NumpadDivide: KeyCode.KP_DIVIDE,
  NumpadMultiply: KeyCode.KP_MULTIPLY,
  NumpadSubtract: KeyCode.KP_MINUS,
  NumpadAdd: KeyCode.KP_PLUS,
  NumpadEnter: KeyCode.KP_ENTER,
  Numpad1: KeyCode.KP_1,
  Numpad2: KeyCode.KP_2,
  Numpad3: KeyCode.KP_3,
  Numpad4: KeyCode.KP_4,
  Numpad5: KeyCode.KP_5,
  Numpad6: KeyCode.KP_6,
  Numpad7: KeyCode.KP_7,
  Numpad8: KeyCode.KP_8,
  Numpad9: KeyCode.KP_9,
  Numpad0: KeyCode.KP_0,
  NumpadDecimal: KeyCode.KP_PERIOD,
  NumpadEqual: KeyCode.KP_EQUALS,
  NumpadComma: KeyCode.KP_COMMA,

  // ---- 符号键 ----
  Backquote: KeyCode.BACKQUOTE,
  Minus: KeyCode.MINUS,
  Equal: KeyCode.EQUALS,
  BracketLeft: KeyCode.LEFTBRACKET,
  BracketRight: KeyCode.RIGHTBRACKET,
  Backslash: KeyCode.BACKSLASH,
  Semicolon: KeyCode.SEMICOLON,
  Quote: KeyCode.QUOTE,
  Comma: KeyCode.COMMA,
  Period: KeyCode.PERIOD,
  Slash: KeyCode.SLASH,
}

// ---------------------------------------------------------------------------
// KeyboardEvent.key 字符 → KeyCode 回退映射表 (用于符号键)
// ---------------------------------------------------------------------------

/**
 * 当 KeyboardEvent.code 未能匹配时的回退映射。
 * 使用 KeyboardEvent.key 的字符值进行映射 (适用于非美国键盘布局)。
 */
const KEY_TO_KEYCODE: Readonly<Record<string, KeyCode>> = {
  '!': KeyCode.EXCLAIM,
  '"': KeyCode.QUOTEDBL,
  '#': KeyCode.HASH,
  '$': KeyCode.DOLLAR,
  '%': KeyCode.PERCENT,
  '&': KeyCode.AMPERSAND,
  "'": KeyCode.QUOTE,
  '(': KeyCode.LEFTPAREN,
  ')': KeyCode.RIGHTPAREN,
  '*': KeyCode.ASTERISK,
  '+': KeyCode.PLUS,
  ',': KeyCode.COMMA,
  '-': KeyCode.MINUS,
  '.': KeyCode.PERIOD,
  '/': KeyCode.SLASH,
  ':': KeyCode.COLON,
  ';': KeyCode.SEMICOLON,
  '<': KeyCode.LESS,
  '=': KeyCode.EQUALS,
  '>': KeyCode.GREATER,
  '?': KeyCode.QUESTION,
  '@': KeyCode.AT,
  '[': KeyCode.LEFTBRACKET,
  '\\': KeyCode.BACKSLASH,
  ']': KeyCode.RIGHTBRACKET,
  '^': KeyCode.CARET,
  '_': KeyCode.UNDERSCORE,
  '`': KeyCode.BACKQUOTE,
}

// ---------------------------------------------------------------------------
// KeyCode → 人类可读名称映射表 (用于热键配置 UI 显示)
// ---------------------------------------------------------------------------

/**
 * KeyCode → 显示名称映射表。
 *
 * OpenRA 对照: KeycodeExts.KeycodeFluentKeys + DisplayString()
 *
 * 在 OpenRA 中，这些字符串通过 Fluent 本地化系统提供。
 * 在此迁移版本中，直接使用英文名称。未来可以集成 i18n。
 */
const KEYCODE_DISPLAY_NAMES: Readonly<Record<KeyCode, string>> = {
  [KeyCode.UNKNOWN]: 'Unknown',
  [KeyCode.RETURN]: 'Enter',
  [KeyCode.ESCAPE]: 'Escape',
  [KeyCode.BACKSPACE]: 'Backspace',
  [KeyCode.TAB]: 'Tab',
  [KeyCode.SPACE]: 'Space',
  [KeyCode.EXCLAIM]: '!',
  [KeyCode.QUOTEDBL]: '"',
  [KeyCode.HASH]: '#',
  [KeyCode.DOLLAR]: '$',
  [KeyCode.PERCENT]: '%',
  [KeyCode.AMPERSAND]: '&',
  [KeyCode.QUOTE]: "'",
  [KeyCode.LEFTPAREN]: '(',
  [KeyCode.RIGHTPAREN]: ')',
  [KeyCode.ASTERISK]: '*',
  [KeyCode.PLUS]: '+',
  [KeyCode.COMMA]: ',',
  [KeyCode.MINUS]: '-',
  [KeyCode.PERIOD]: '.',
  [KeyCode.SLASH]: '/',
  [KeyCode.NUMBER_0]: '0',
  [KeyCode.NUMBER_1]: '1',
  [KeyCode.NUMBER_2]: '2',
  [KeyCode.NUMBER_3]: '3',
  [KeyCode.NUMBER_4]: '4',
  [KeyCode.NUMBER_5]: '5',
  [KeyCode.NUMBER_6]: '6',
  [KeyCode.NUMBER_7]: '7',
  [KeyCode.NUMBER_8]: '8',
  [KeyCode.NUMBER_9]: '9',
  [KeyCode.COLON]: ':',
  [KeyCode.SEMICOLON]: ';',
  [KeyCode.LESS]: '<',
  [KeyCode.EQUALS]: '=',
  [KeyCode.GREATER]: '>',
  [KeyCode.QUESTION]: '?',
  [KeyCode.AT]: '@',
  [KeyCode.LEFTBRACKET]: '[',
  [KeyCode.BACKSLASH]: '\\',
  [KeyCode.RIGHTBRACKET]: ']',
  [KeyCode.CARET]: '^',
  [KeyCode.UNDERSCORE]: '_',
  [KeyCode.BACKQUOTE]: '`',
  [KeyCode.A]: 'A',
  [KeyCode.B]: 'B',
  [KeyCode.C]: 'C',
  [KeyCode.D]: 'D',
  [KeyCode.E]: 'E',
  [KeyCode.F]: 'F',
  [KeyCode.G]: 'G',
  [KeyCode.H]: 'H',
  [KeyCode.I]: 'I',
  [KeyCode.J]: 'J',
  [KeyCode.K]: 'K',
  [KeyCode.L]: 'L',
  [KeyCode.M]: 'M',
  [KeyCode.N]: 'N',
  [KeyCode.O]: 'O',
  [KeyCode.P]: 'P',
  [KeyCode.Q]: 'Q',
  [KeyCode.R]: 'R',
  [KeyCode.S]: 'S',
  [KeyCode.T]: 'T',
  [KeyCode.U]: 'U',
  [KeyCode.V]: 'V',
  [KeyCode.W]: 'W',
  [KeyCode.X]: 'X',
  [KeyCode.Y]: 'Y',
  [KeyCode.Z]: 'Z',
  [KeyCode.CAPSLOCK]: 'Caps Lock',
  [KeyCode.F1]: 'F1',
  [KeyCode.F2]: 'F2',
  [KeyCode.F3]: 'F3',
  [KeyCode.F4]: 'F4',
  [KeyCode.F5]: 'F5',
  [KeyCode.F6]: 'F6',
  [KeyCode.F7]: 'F7',
  [KeyCode.F8]: 'F8',
  [KeyCode.F9]: 'F9',
  [KeyCode.F10]: 'F10',
  [KeyCode.F11]: 'F11',
  [KeyCode.F12]: 'F12',
  [KeyCode.PRINTSCREEN]: 'Print Screen',
  [KeyCode.SCROLLLOCK]: 'Scroll Lock',
  [KeyCode.PAUSE]: 'Pause',
  [KeyCode.INSERT]: 'Insert',
  [KeyCode.HOME]: 'Home',
  [KeyCode.PAGEUP]: 'Page Up',
  [KeyCode.DELETE]: 'Delete',
  [KeyCode.END]: 'End',
  [KeyCode.PAGEDOWN]: 'Page Down',
  [KeyCode.RIGHT]: 'Right',
  [KeyCode.LEFT]: 'Left',
  [KeyCode.DOWN]: 'Down',
  [KeyCode.UP]: 'Up',
  [KeyCode.NUMLOCKCLEAR]: 'Num Lock',
  [KeyCode.KP_DIVIDE]: 'Num /',
  [KeyCode.KP_MULTIPLY]: 'Num *',
  [KeyCode.KP_MINUS]: 'Num -',
  [KeyCode.KP_PLUS]: 'Num +',
  [KeyCode.KP_ENTER]: 'Num Enter',
  [KeyCode.KP_1]: 'Num 1',
  [KeyCode.KP_2]: 'Num 2',
  [KeyCode.KP_3]: 'Num 3',
  [KeyCode.KP_4]: 'Num 4',
  [KeyCode.KP_5]: 'Num 5',
  [KeyCode.KP_6]: 'Num 6',
  [KeyCode.KP_7]: 'Num 7',
  [KeyCode.KP_8]: 'Num 8',
  [KeyCode.KP_9]: 'Num 9',
  [KeyCode.KP_0]: 'Num 0',
  [KeyCode.KP_PERIOD]: 'Num .',
  [KeyCode.APPLICATION]: 'Application',
  [KeyCode.POWER]: 'Power',
  [KeyCode.KP_EQUALS]: 'Num =',
  [KeyCode.F13]: 'F13',
  [KeyCode.F14]: 'F14',
  [KeyCode.F15]: 'F15',
  [KeyCode.F16]: 'F16',
  [KeyCode.F17]: 'F17',
  [KeyCode.F18]: 'F18',
  [KeyCode.F19]: 'F19',
  [KeyCode.F20]: 'F20',
  [KeyCode.F21]: 'F21',
  [KeyCode.F22]: 'F22',
  [KeyCode.F23]: 'F23',
  [KeyCode.F24]: 'F24',
  [KeyCode.EXECUTE]: 'Execute',
  [KeyCode.HELP]: 'Help',
  [KeyCode.MENU]: 'Menu',
  [KeyCode.SELECT]: 'Select',
  [KeyCode.STOP]: 'Stop',
  [KeyCode.AGAIN]: 'Again',
  [KeyCode.UNDO]: 'Undo',
  [KeyCode.CUT]: 'Cut',
  [KeyCode.COPY]: 'Copy',
  [KeyCode.PASTE]: 'Paste',
  [KeyCode.FIND]: 'Find',
  [KeyCode.MUTE]: 'Mute',
  [KeyCode.VOLUMEUP]: 'Volume Up',
  [KeyCode.VOLUMEDOWN]: 'Volume Down',
  [KeyCode.LCTRL]: 'Left Ctrl',
  [KeyCode.LSHIFT]: 'Left Shift',
  [KeyCode.LALT]: 'Left Alt',
  [KeyCode.LGUI]: 'Left Win',
  [KeyCode.RCTRL]: 'Right Ctrl',
  [KeyCode.RSHIFT]: 'Right Shift',
  [KeyCode.RALT]: 'Right Alt',
  [KeyCode.RGUI]: 'Right Win',
  [KeyCode.MODE]: 'Mode',
  [KeyCode.AUDIONEXT]: 'Next Track',
  [KeyCode.AUDIOPREV]: 'Prev Track',
  [KeyCode.AUDIOSTOP]: 'Stop Media',
  [KeyCode.AUDIOPLAY]: 'Play/Pause',
  [KeyCode.AUDIOMUTE]: 'Audio Mute',
  [KeyCode.MEDIASELECT]: 'Media Select',
  [KeyCode.WWW]: 'WWW',
  [KeyCode.MAIL]: 'Mail',
  [KeyCode.CALCULATOR]: 'Calculator',
  [KeyCode.COMPUTER]: 'My Computer',
  [KeyCode.AC_SEARCH]: 'Search',
  [KeyCode.AC_HOME]: 'Home Page',
  [KeyCode.AC_BACK]: 'Back',
  [KeyCode.AC_FORWARD]: 'Forward',
  [KeyCode.AC_STOP]: 'Stop',
  [KeyCode.AC_REFRESH]: 'Refresh',
  [KeyCode.AC_BOOKMARKS]: 'Bookmarks',
  [KeyCode.BRIGHTNESSDOWN]: 'Brightness Down',
  [KeyCode.BRIGHTNESSUP]: 'Brightness Up',
  [KeyCode.DISPLAYSWITCH]: 'Display Switch',
  [KeyCode.KBDILLUMTOGGLE]: 'Keyboard Illum Toggle',
  [KeyCode.KBDILLUMDOWN]: 'Keyboard Illum Down',
  [KeyCode.KBDILLUMUP]: 'Keyboard Illum Up',
  [KeyCode.EJECT]: 'Eject',
  [KeyCode.SLEEP]: 'Sleep',
  [KeyCode.MOUSE4]: 'Mouse 4',
  [KeyCode.MOUSE5]: 'Mouse 5',
} as unknown as Readonly<Record<KeyCode, string>>

// ---------------------------------------------------------------------------
// 公共 API：KeyCode 辅助函数
// ---------------------------------------------------------------------------

/**
 * 从浏览器 KeyboardEvent 中提取 KeyCode。
 *
 * 首先尝试通过 KeyboardEvent.code 映射 (主要路径)，
 * 如果失败则回退到 KeyboardEvent.key 字符映射 (用于非美国键盘布局)。
 *
 * @param event — 浏览器 KeyboardEvent
 * @returns 对应的 KeyCode 枚举值，无法识别则返回 KeyCode.UNKNOWN
 */
export function keyCodeFromKeyboardEvent(event: KeyboardEvent): KeyCode {
  // 主要路径: event.code → KeyCode (适用于标准美国键盘布局)
  if (event.code && event.code in CODE_TO_KEYCODE) {
    return CODE_TO_KEYCODE[event.code]
  }

  // 回退路径: event.key → KeyCode (适用于非美国键盘布局的符号键)
  if (event.key && event.key in KEY_TO_KEYCODE) {
    return KEY_TO_KEYCODE[event.key]
  }

  // 进一步回退: 对单字符键，尝试匹配 ASCII 字母/数字
  if (event.key && event.key.length === 1) {
    const ch = event.key.charCodeAt(0)
    if (ch >= 97 && ch <= 122) {
      // 'a' - 'z'
      return ch as KeyCode
    }
    if (ch >= 48 && ch <= 57) {
      // '0' - '9'
      return ch as KeyCode
    }
  }

  return KeyCode.UNKNOWN
}

/**
 * 从 SDL 键码数值中提取 KeyCode。
 *
 * OpenRA 对照: 隐式转换 int → Keycode (C# enum)
 *
 * @param sdlKey — SDL 键码数值 (来自 OpenRA 热键配置文件)
 * @returns 对应的 KeyCode，无效则返回 KeyCode.UNKNOWN
 */
export function keyCodeFromSDLK(sdlKey: number): KeyCode {
  // O(n) 线性扫描 ~230 个 KeyCode 值。
  // 性能: 此函数仅在热键配置加载时调用 (离线路径), 不在每帧热路径上。
  // 可接受 ~230 次比较的常数级开销。
  for (const value of Object.values(KeyCode) as KeyCode[]) {
    if (value === sdlKey) {
      return value
    }
  }
  return KeyCode.UNKNOWN
}

/**
 * 获取 KeyCode 的人类可读显示名称。
 *
 * OpenRA 对照: KeycodeExts.DisplayString(Keycode k)
 *
 * @param code — KeyCode 枚举值
 * @returns 显示名称。未知键码返回 "Unknown"。
 */
export function keyName(code: KeyCode): string {
  return KEYCODE_DISPLAY_NAMES[code] ?? 'Unknown'
}

/**
 * 检查给定的键盘事件是否是修饰键事件。
 *
 * 浏览器预留的快捷键 (F12, Ctrl+W, Ctrl+N, Ctrl+T 等) 不应被游戏捕获。
 * 此函数检查事件是否为纯修饰键 (没有附加字符键的修饰键按下)。
 *
 * @param event — 浏览器 KeyboardEvent
 * @returns 如果事件是浏览器应保留的键则返回 true
 */
export function isBrowserReservedKey(event: KeyboardEvent): boolean {
  // F12 — 开发者工具
  if (event.code === 'F12') return true
  // 浏览器快捷键组合 (Ctrl + W/N/T — 关闭/新建/新标签页)
  if (event.ctrlKey && (event.code === 'KeyW' || event.code === 'KeyN' || event.code === 'KeyT')) {
    return true
  }
  // Ctrl+Shift+N — 隐私标签页 (Chrome)
  if (event.ctrlKey && event.shiftKey && event.code === 'KeyN') return true
  // Ctrl+Shift+T — 重新打开关闭的标签页
  if (event.ctrlKey && event.shiftKey && event.code === 'KeyT') return true
  return false
}
