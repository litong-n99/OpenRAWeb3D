/**
 * ChromeMetrics.ts — UI 主题默认值存储
 * OpenRA 对照: OpenRA.Game/Widgets/ChromeMetrics.cs (49 lines)
 *
 * 核心范式转换:
 * - C# FieldLoader.GetValue<T>() 反射式类型转换 → TypeScript 类型守卫 + 强制转换
 * - C# Dictionary<string, string> → Map<string, string | number>
 * - CSS 集成: 每个 ChromeMetrics 值映射到 CSS 自定义属性
 *   get() 先查内存 values，回退到 getComputedStyle().getPropertyValue()
 */

// ---------------------------------------------------------------------------
// ChromeMetrics — 主题默认值
// OpenRA 对照: static class ChromeMetrics (ChromeMetrics.cs:17-48)
// ---------------------------------------------------------------------------

/** UI 主题默认值存储。
 *
 * 提供类型化的度量值访问。度量值可以从 JSON 初始化
 * （由 MiniYAML 预编译）或从 CSS 自定义属性读取。
 *
 * CSS 集成示例:
 * ```css
 * :root {
 *   --button-depth: 2px;
 *   --font-size-title: 24px;
 *   --color-panel-background: #1a1a1a;
 * }
 * ```
 *
 * OpenRA 对照: static class ChromeMetrics
 */
export class ChromeMetrics {
  /** 内存中的键值对存储。 */
  private static _data = new Map<string, string | number>()

  /** 是否已初始化。 */
  private static _initialized = false

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  /** 从 JSON（MiniYAML 预编译）初始化。
   *
   * OpenRA 对照: ChromeMetrics.Initialize(ModData)
   *
   * @param json — 键值对对象（值可以是 string 或 number）
   */
  static initialize(json: Record<string, string | number>): void {
    ChromeMetrics._data.clear()
    for (const [key, value] of Object.entries(json)) {
      ChromeMetrics._data.set(key, value)
    }
    ChromeMetrics._initialized = true
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /** 类型化访问器。
   *
   * 查找顺序:
   * 1. 内存中的 _data Map
   * 2. CSS 自定义属性 (getComputedStyle)
   * 3. 抛出异常（如果都未找到）
   *
   * OpenRA 对照: ChromeMetrics.Get<T>(string)
   *
   * @param key — 度量值键名
   * @returns 转换后的值
   * @throws 如果键在内存和 CSS 中均未找到
   */
  static get<T extends string | number>(key: string): T {
    // 1. 内存查找
    if (ChromeMetrics._data.has(key)) {
      return ChromeMetrics._coerce<T>(ChromeMetrics._data.get(key)!)
    }

    // 2. CSS 自定义属性回退
    const cssValue = ChromeMetrics._readCssProperty(key)
    if (cssValue !== null) {
      return ChromeMetrics._coerce<T>(cssValue)
    }

    throw new Error(`ChromeMetrics: key '${key}' not found in data or CSS.`)
  }

  /** 安全访问器 — 如果找不到则返回 undefined。
   *
   * OpenRA 对照: ChromeMetrics.TryGet<T>(string, out T)
   *
   * @param key — 度量值键名
   * @returns 转换后的值，或 undefined
   */
  static tryGet<T extends string | number>(key: string): T | undefined {
    // 1. 内存查找
    if (ChromeMetrics._data.has(key)) {
      return ChromeMetrics._coerce<T>(ChromeMetrics._data.get(key)!)
    }

    // 2. CSS 自定义属性回退
    const cssValue = ChromeMetrics._readCssProperty(key)
    if (cssValue !== null) {
      return ChromeMetrics._coerce<T>(cssValue)
    }

    return undefined
  }

  // ---------------------------------------------------------------------------
  // CSS Integration
  // ---------------------------------------------------------------------------

  /** 从 CSS 自定义属性读取值。 */
  private static _readCssProperty(key: string): string | null {
    if (typeof document === 'undefined') return null

    try {
      const cssKey = key.startsWith('--') ? key : `--${key}`
      const value = getComputedStyle(document.documentElement).getPropertyValue(
        cssKey,
      )
      return value.trim() || null
    } catch {
      return null
    }
  }

  /** 将存储的值返回为请求的类型。
   *
   * NOTE: TypeScript 在运行时无法区分泛型参数 T。
   * 值按存储的类型原样返回。调用方负责确保类型一致性。
   * 数值字符串不会被自动转换为数字 — 这是有意与 OpenRA 的
   * FieldLoader.GetValue<T> 行为不同，因为后者使用反射确定 T。
   */
  private static _coerce<T extends string | number>(value: string | number): T {
    return value as T
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  /** 清除所有数据（用于测试/重置）。 */
  static reset(): void {
    ChromeMetrics._data.clear()
    ChromeMetrics._initialized = false
  }

  /** 获取是否已初始化。 */
  static get initialized(): boolean {
    return ChromeMetrics._initialized
  }

  /** 获取所有键（用于调试）。 */
  static get keys(): string[] {
    return [...ChromeMetrics._data.keys()]
  }

  /** 获取数据映射的只读副本（用于调试）。 */
  static get data(): ReadonlyMap<string, string | number> {
    return ChromeMetrics._data
  }
}
