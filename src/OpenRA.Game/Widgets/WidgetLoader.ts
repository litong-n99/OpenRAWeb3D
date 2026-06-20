/**
 * WidgetLoader.ts — 从预编译 JSON 布局实例化 Widget 树
 * OpenRA 对照: OpenRA.Game/Widgets/WidgetLoader.cs (83 lines)
 *
 * 核心范式转换:
 * - C# MiniYaml MiniYamlNode → JSON 对象 Record<string, unknown>
 * - C# FieldLoader.LoadFieldOrProperty → Object.assign + 直接属性赋值
 * - C# Game.ModData.ObjectCreator.CreateObject → ObjectCreator.createObject
 * - C# IntegerExpression.Evaluate() → evaluateExpression() 静态方法
 * - C# MiniYaml Merge / FromStream → JSON.parse (从 fetch 预加载)
 */

import type { WidgetArgs, Widget } from './Widget.js'
import type { Manifest } from '../Manifest.js'
import type { IReadOnlyFileSystem } from '../FileSystem/IPackage.js'
import type { ObjectCreator } from '../ModData.js'

// ---------------------------------------------------------------------------
// WidgetDefinitionNode — JSON 布局中的单个 widget 节点
// ---------------------------------------------------------------------------

/**
 * Widget JSON 节点结构。
 *
 * MiniYAML `Container@MAIN_MENU:` 转换为 JSON 后:
 * ```json
 * {
 *   "Container@MAIN_MENU": {
 *     "X": 100,
 *     "Width": "WINDOW_WIDTH - 200",
 *     "Children": {
 *       "Button@OK": { "Width": 100 }
 *     },
 *     "Logic": {
 *       "MainMenuLogic": { "arg": "value" }
 *     }
 *   }
 * }
 * ```
 */
export interface WidgetDefinitionNode {
  [key: string]: unknown
  /** 子 widget 映射 (Type@Id → 属性对象)。 */
  Children?: Record<string, WidgetDefinitionNode>
  /** Logic 映射 (LogicClassName → 参数对象)。 */
  Logic?: Record<string, Record<string, unknown>>
}

// ---------------------------------------------------------------------------
// WidgetLoader
// OpenRA 对照: WidgetLoader (WidgetLoader.cs:20-82)
// ---------------------------------------------------------------------------

/** 从预编译 JSON 布局实例化 Widget 树。
 *
 * 六步实例化流程:
 * 1. 从 widgetDefinitions 查找 widget ID
 * 2. 通过 ObjectCreator 创建实例
 * 3. 注入属性（Object.assign + 类型守卫）
 * 4. 调用 initialize(args) — 解析 Bounds 表达式
 * 5. 递归加载子 widget
 * 6. 调用 postInit(args) — 实例化 ChromeLogic
 *
 * OpenRA 对照: class WidgetLoader
 */
export class WidgetLoader {
  /** Widget ID (Type@Id 字符串) → 定义节点映射。 */
  private _widgetDefinitions = new Map<string, WidgetDefinitionNode>()

  /** 用于创建 Widget 和 ChromeLogic 实例的对象工厂。 */
  private _objectCreator: ObjectCreator

  /** Widget 类型注册表: 类型名 → 构造函数。 */
  private _widgetRegistry = new Map<string, new () => Widget>()

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  /**
   * 创建 WidgetLoader。
   *
   * OpenRA 对照: WidgetLoader(Manifest, IReadOnlyFileSystem)
   *
   * @param objectCreator — 用于创建 Widget 实例
   */
  constructor(objectCreator: ObjectCreator) {
    this._objectCreator = objectCreator
  }

  // ---------------------------------------------------------------------------
  // Widget Registry — 核心扩展点
  // ---------------------------------------------------------------------------

  /** 注册 widget 类型。
   *
   * Mod 代码调用此方法注册自定义 widget 类型。
   * 例如: `loader.registerWidget('Button', ButtonWidget)`
   *
   * @param typeName — 类型名称（例如 "Button"、"ScrollPanel"）
   * @param ctor — widget 构造函数
   */
  registerWidget(typeName: string, ctor: new () => Widget): void {
    this._widgetRegistry.set(typeName, ctor)
    this._objectCreator.register(typeName + 'Widget', ctor)
  }

  // ---------------------------------------------------------------------------
  // Layout Loading
  // ---------------------------------------------------------------------------

  /** 从 JSON 对象加载 widget 布局。
   *
   * 通常由外部调用，传入从 manifest.chromeLayout 文件读取并解析的 JSON。
   *
   * @param layoutJson — 布局 JSON 对象 (顶层键为 Type@Id)
   */
  loadLayout(layoutJson: Record<string, WidgetDefinitionNode>, sourcePath?: string): void {
    // Counter for disambiguating id-less nodes from the same source file.
    // Only used as a last-resort fallback when neither @ suffix nor node.id exists.
    let anonymousCounter = 0

    for (const [origKey, node] of Object.entries(layoutJson)) {
      const hasAt = origKey.includes('@')
      const nodeId = typeof node['id'] === 'string' ? node['id'] : undefined
      let suffix = hasAt
        ? origKey.slice(origKey.indexOf('@') + 1)
        : (nodeId ?? origKey)

      // When neither @ nor node.id exists, generate an internal disambiguation
      // suffix. Prefix with __anon__ so loadWidget can distinguish auto-generated
      // suffixes from real @Name suffixes and skip setting widget.id.
      let isAnonymous = false
      if (!hasAt && !nodeId) {
        isAnonymous = true
        if (sourcePath) {
          suffix = `__anon__${origKey}_${sourcePath.replace(/[/:@]/g, '_')}`
        } else {
          suffix = `__anon__${origKey}_${++anonymousCounter}`
        }
      }

      const mapKey = hasAt ? origKey
        : (nodeId ? `${origKey}@${nodeId}` : `${origKey}@${suffix}`)

      for (const [existingKey, existingNode] of this._widgetDefinitions) {
        const existingNodeId = typeof existingNode['id'] === 'string' ? existingNode['id'] : undefined
        const existingSuffix = existingKey.includes('@')
          ? existingKey.slice(existingKey.indexOf('@') + 1)
          : (existingNodeId ?? existingKey)
        if (existingSuffix === suffix) {
          throw new Error(`Widget has duplicate Key '${origKey}'`)
        }
      }
      this._widgetDefinitions.set(mapKey, node)
    }
  }

  /** 异步加载布局。
   *
   * 从 manifest 读取 chromeLayout 文件列表，逐个 fetch 并解析 JSON，
   * 然后合并到 widgetDefinitions。
   *
   * @param manifest — mod 清单
   * @param fileSystem — 文件系统
   */
  async loadFromManifest(
    manifest: Manifest,
    fileSystem: IReadOnlyFileSystem,
  ): Promise<void> {
    for (const file of manifest.chromeLayout) {
      const data = await fileSystem.openAsync(file)
      if (!data) {
        throw new Error(`WidgetLoader: cannot open layout file '${file}'`)
      }
      const text = new TextDecoder().decode(data)
      const json = JSON.parse(text) as Record<string, WidgetDefinitionNode>
      this.loadLayout(json, file)
    }
  }

  // ---------------------------------------------------------------------------
  // Widget Loading
  // ---------------------------------------------------------------------------

  /** 按布局名称加载顶层 UI。
   *
   * OpenRA 对照: 间接映射自 Ui.OpenWindow → WidgetLoader.LoadWidget(string id)
   *
   * @param name — 布局名称（如 "MAIN_MENU"），对应 Type@Id 中的 Id 部分
   * @param args — widget 参数
   * @returns 根 ContainerWidget
   */
  loadUI(name: string, args: WidgetArgs): Widget {
    // 查找匹配的 Type@Id（遍历所有键）
    for (const [key, node] of this._widgetDefinitions) {
      const atIndex = key.indexOf('@')
      const id = atIndex >= 0 ? key.slice(atIndex + 1) : key
      if (id === name) {
        return this.loadWidget(args, null, key, node)
      }
    }
    // BLOCKER #1 fix: MiniYamlParser strips @Name from keys and stores it as
    // node.id. Check the 'id' property on each node as a secondary match.
    for (const [key, node] of this._widgetDefinitions) {
      const nodeId = (node as Record<string, unknown>)['id']
      if (typeof nodeId === 'string' && nodeId === name) {
        return this.loadWidget(args, null, key, node)
      }
    }
    throw new Error(`Cannot find widget with Id '${name}'`)
  }

  /** 按定义节点加载 widget。
   *
   * OpenRA 对照: LoadWidget(WidgetArgs, Widget, MiniYamlNode)
   *
   * @param args — widget 参数
   * @param parent — 父 widget（根为 null）
   * @param key — widget 类型+ID 字符串 (e.g., "Container@MAIN_MENU")
   * @param node — widget 定义节点
   * @returns 实例化的 widget
   */
  loadWidget(
    args: WidgetArgs,
    parent: Widget | null,
    key: string,
    node: WidgetDefinitionNode,
  ): Widget {
    // Step 1: Create widget instance
    const widget = this._createWidget(key, args)

    // Step 2: Attach to parent
    if (parent) {
      parent.addChild(widget)
    }

    // Step 3: Set Id from @ suffix, or from node's 'id' property
    // BLOCKER #1 fix: MiniYamlParser may strip @Name from keys and store
    // it as node.id (e.g. key="Container", node={id:"MAINMENU"}).
    // Priority: node's explicit 'Id' property > @ suffix > node's 'id' property
    const atIndex = key.indexOf('@')
    if (atIndex >= 0) {
      const suffixId = key.slice(atIndex + 1)
      // Auto-generated disambiguation suffixes (prefixed with __anon__) are
      // internal to WidgetLoader — do NOT set them as the visible widget id.
      if (!suffixId.startsWith('__anon__')) {
        widget.id = suffixId
      }
    } else {
      // Key has no @ suffix — check node's 'id' property (not 'Id' which is
      // handled separately by _setWidgetProperty for runtime override)
      const nodeId = (node as Record<string, unknown>)['id']
      if (typeof nodeId === 'string') {
        widget.id = nodeId
      }
    }

    // Step 4: Inject properties (skip Children and Logic)
    for (const [propKey, propValue] of Object.entries(node)) {
      if (propKey === 'Children' || propKey === 'Logic') continue
      this._setWidgetProperty(widget, propKey, propValue)
    }

    // Step 5: Initialize bounds
    widget.initialize(args)

    // Step 6: Load children recursively
    const children = node['Children'] as
      | Record<string, WidgetDefinitionNode | WidgetDefinitionNode[]>
      | undefined
    if (children) {
      for (const [childKey, childNode] of Object.entries(children)) {
        // OpenRA YAML allows array syntax for multiple widgets of the same
        // type (e.g. "Button": [{id:"A"},{id:"B"}]). Each array element is
        // a separate widget instance of type childKey.
        //
        // Wrap in try/catch so a single unregistered widget type (e.g.
        // PerfGraph inside a hidden PERFORMANCE_INFO container) doesn't
        // prevent the rest of the widget tree from loading.
        try {
          if (Array.isArray(childNode)) {
            for (const item of childNode) {
              this.loadWidget(args, widget, childKey, item)
            }
          } else {
            this.loadWidget(args, widget, childKey, childNode)
          }
        } catch (err) {
          console.warn(
            `[WidgetLoader] Failed to load child '${childKey}' in '${widget.id || key}':`,
            err instanceof Error ? err.message : String(err),
          )
        }
      }
    }

    // Step 7: Post-init with logic
    const logicNode = node['Logic'] as
      | Record<string, Record<string, unknown>>
      | undefined
    const logicArgs: Record<string, unknown> = {}
    if (logicNode) {
      // Extract ChromeLogic class names from Logic node keys
      widget.logic = Object.keys(logicNode)

      // Build logic args: LogicClassName → params
      for (const [logicName, params] of Object.entries(logicNode)) {
        logicArgs[logicName] = params
      }
    }
    args['logicArgs'] = logicArgs
    widget.postInit(args)
    delete args['logicArgs']

    return widget
  }

  /** 按 ID 查找并加载 widget。
   *
   * OpenRA 对照: LoadWidget(WidgetArgs, Widget, string)
   *
   * @param args — widget 参数
   * @param parent — 父 widget
   * @param id — widget ID (Type@Id 字符串)
   * @returns 实例化的 widget
   */
  loadWidgetById(args: WidgetArgs, parent: Widget | null, id: string): Widget {
    // Direct lookup first (key may match exactly, or be synthetic "Type@Id")
    let node = this._widgetDefinitions.get(id)
    let lookupKey = id

    // Fallback 1: search by node.id (MiniYamlParser @Name artifact)
    if (!node) {
      for (const [key, def] of this._widgetDefinitions) {
        const nodeId = (def as Record<string, unknown>)['id']
        if (typeof nodeId === 'string' && nodeId === id) {
          node = def
          lookupKey = key
          break
        }
      }
    }

    // Fallback 2: id is a bare type name (e.g. "Container"). Match stored
    // keys that start with "Type@" (synthetic keys for id-less nodes).
    if (!node && !id.includes('@')) {
      for (const [key, def] of this._widgetDefinitions) {
        if (key.startsWith(id + '@')) {
          node = def
          lookupKey = key
          break
        }
      }
    }

    if (!node) {
      throw new Error(`Cannot find widget with Id '${id}'`)
    }
    return this.loadWidget(args, parent, lookupKey, node)
  }

  // ---------------------------------------------------------------------------
  // Widget Creation
  // ---------------------------------------------------------------------------

  /** 创建 widget 实例。
   *
   * OpenRA 对照: NewWidget(string, WidgetArgs)
   */
  private _createWidget(key: string, _args: WidgetArgs): Widget {
    const atIndex = key.indexOf('@')
    const typeName = atIndex >= 0 ? key.slice(0, atIndex) : key
    const fullName = typeName + 'Widget'

    // Try registered widget constructor first (faster)
    const ctor = this._widgetRegistry.get(typeName)
    if (ctor) {
      return new ctor()
    }

    // Try ObjectCreator
    const widget = this._objectCreator.createObject<Widget>(fullName)
    if (widget) return widget

    throw new Error(
      `Cannot create widget of type '${fullName}': type not registered.`,
    )
  }

  // ---------------------------------------------------------------------------
  // Property Injection
  // ---------------------------------------------------------------------------

  /** 设置 widget 属性。
   *
   * OpenRA 对照: FieldLoader.LoadFieldOrProperty
   *
   * 处理以下属性名称映射:
   * - X → _xExpr, Y → _yExpr, Width → _widthExpr, Height → _heightExpr
   * - Visible → visible, Id → id, Logic → logic
   * - ClickThrough → (ContainerWidget).clickThrough (NOTE: handled in node iteration)
   * - Disabled → (InputWidget).disabled
   */
  private _setWidgetProperty(
    widget: Widget,
    key: string,
    value: unknown,
  ): void {
    switch (key) {
      case 'X':
        widget._xExpr =
          typeof value === 'number' || typeof value === 'string' ? value : 0
        break
      case 'Y':
        widget._yExpr =
          typeof value === 'number' || typeof value === 'string' ? value : 0
        break
      case 'Width':
        widget._widthExpr =
          typeof value === 'number' || typeof value === 'string' ? value : 0
        break
      case 'Height':
        widget._heightExpr =
          typeof value === 'number' || typeof value === 'string' ? value : 0
        break
      case 'Visible':
        widget.visible =
          typeof value === 'boolean'
            ? value
            : typeof value === 'string'
              ? value.toLowerCase() !== 'false'
              : true
        break
      case 'Id':
        if (typeof value === 'string') widget.id = value
        break
      case 'Logic':
        if (Array.isArray(value)) {
          widget.logic = value.map(String)
        }
        break
      case 'IgnoreMouseOver':
        widget.ignoreMouseOver = Boolean(value)
        break
      case 'IgnoreChildMouseOver':
        widget.ignoreChildMouseOver = Boolean(value)
        break
      default:
        // Unrecognized property — try direct assignment
        if (key in widget) {
          ;(widget as unknown as Record<string, unknown>)[key] = value
        }
        break
    }
  }

  // ---------------------------------------------------------------------------
  // Expression Evaluation
  // OpenRA 对照: IntegerExpression.Evaluate (间接)
  // ---------------------------------------------------------------------------

  /** 表达式求值器 — 解析 Bounds 表达式。
   *
   * OpenRA 对照: Widget.Initialize() 中的 substitutions 逻辑
   *
   * 支持变量: WINDOW_WIDTH, WINDOW_HEIGHT, PARENT_WIDTH, PARENT_HEIGHT, WIDTH, HEIGHT
   * 支持运算符: + - * /
   * 没有运算符优先级 — 从左到右求值（匹配 OpenRA 的 IntegerExpression 行为）
   *
   * @param expr — 表达式字符串（如 "WINDOW_WIDTH - 200"）或字面数字
   * @param vars — 变量名 → 值
   * @returns 求值结果
   */
  static evaluateExpression(
    expr: string | number | undefined,
    vars: Record<string, number>,
  ): number {
    // 未定义 → 0
    if (expr === undefined || expr === null) return 0

    // 数字 → 直接返回
    if (typeof expr === 'number') return expr

    // 字符串 → 解析表达式
    const trimmed = expr.trim()
    if (trimmed === '') return 0

    // 尝试解析为纯数字
    const pureNum = Number(trimmed)
    if (!Number.isNaN(pureNum) && trimmed !== '') {
      return pureNum
    }

    // Tokenize on whitespace
    const tokens = trimmed.split(/\s+/).filter((t) => t.length > 0)
    if (tokens.length === 0) return 0

    // Single token → variable or number
    if (tokens.length === 1) {
      return WidgetLoader._resolveToken(tokens[0], vars)
    }

    // Left-to-right evaluation (no operator precedence, matching OpenRA)
    let result = WidgetLoader._resolveToken(tokens[0], vars)
    for (let i = 1; i < tokens.length; i += 2) {
      const op = tokens[i]
      const operand = WidgetLoader._resolveToken(
        tokens[i + 1] ?? '0',
        vars,
      )
      switch (op) {
        case '+':
          result = result + operand
          break
        case '-':
          result = result - operand
          break
        case '*':
          result = result * operand
          break
        case '/':
          result = operand !== 0 ? Math.trunc(result / operand) : 0
          break
        default:
          // Unknown operator — skip
          break
      }
    }

    return result
  }

  /** 解析单个 token — 变量名或数字字面值。 */
  private static _resolveToken(
    token: string,
    vars: Record<string, number>,
  ): number {
    // Try as variable name
    if (token in vars) {
      return vars[token]
    }

    // Try as number
    const num = Number(token)
    if (!Number.isNaN(num)) {
      return num
    }

    // Unknown → 0
    return 0
  }

  // ---------------------------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------------------------

  /** 获取已加载的 widget 定义数量。 */
  get definitionCount(): number {
    return this._widgetDefinitions.size
  }

  /** 获取所有已注册的 widget ID。 */
  get registeredIds(): string[] {
    return [...this._widgetDefinitions.keys()]
  }

  /** 检查 widget ID 是否已加载。 */
  hasWidget(id: string): boolean {
    return this._widgetDefinitions.has(id)
  }
}
