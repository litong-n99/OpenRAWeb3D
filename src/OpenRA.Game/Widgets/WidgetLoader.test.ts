/**
 * WidgetLoader.test.ts — WidgetLoader JSON 布局加载器 单元测试
 *
 * 测试覆盖:
 * - evaluateExpression: 基本算术、变量替换、未定义→0、左到右求值
 * - registerWidget: 类型注册
 * - loadLayout: 加载 widget 定义
 * - loadWidget: 六步实例化流程
 * - loadUI: 按名称加载顶层 UI
 * - loadWidgetById: 按 ID 加载
 * - 属性注入: _xExpr/_yExpr/_widthExpr/_heightExpr/visible/id/logic
 * - Children 递归加载
 * - Logic 节点处理
 * - 重复键检测
 * - 未知 widget 类型错误
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { WidgetLoader, type WidgetDefinitionNode } from './WidgetLoader.js'
import type { WidgetArgs } from './Widget.js'
import { Widget, ContainerWidget, Ui } from './Widget.js'
import { ChromeMetrics } from './ChromeMetrics.js'
import { ObjectCreator } from '../ModData.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal ObjectCreator mock via unknown cast to bypass private _registry. */
function makeObjectCreator(): ObjectCreator {
  const registry = new Map<string, new (...args: unknown[]) => unknown>()
  const mock = {
    register(name: string, ctor: new (...args: unknown[]) => unknown) {
      registry.set(name, ctor)
    },
    createObject<T = unknown>(name: string, ..._args: unknown[]): T | null {
      const ctor = registry.get(name)
      if (ctor) return new ctor() as T
      return null
    },
    getType(name: string) {
      return registry.get(name)
    },
    get registeredNames(): readonly string[] {
      return [...registry.keys()]
    },
    dispose() { registry.clear() },
    // Non-standard accessor for tests to add entries
    _addEntry(name: string, ctor: new (...args: unknown[]) => unknown) {
      registry.set(name, ctor)
    },
  }
  return mock as unknown as ObjectCreator
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  ChromeMetrics.initialize({ DefaultCursor: 'default' })
  Widget.windowWidth = 1280
  Widget.windowHeight = 720
})

afterEach(() => {
  ChromeMetrics.reset()
  Ui.dispose()
})

// ===========================================================================
// evaluateExpression
// ===========================================================================

describe('WidgetLoader.evaluateExpression', () => {
  it('returns 0 for undefined', () => {
    expect(WidgetLoader.evaluateExpression(undefined, {})).toBe(0)
  })

  it('returns 0 for null', () => {
    expect(WidgetLoader.evaluateExpression(null as unknown as string, {})).toBe(0)
  })

  it('returns 0 for empty string', () => {
    expect(WidgetLoader.evaluateExpression('', {})).toBe(0)
    expect(WidgetLoader.evaluateExpression('   ', {})).toBe(0)
  })

  it('returns number as-is', () => {
    expect(WidgetLoader.evaluateExpression(42, {})).toBe(42)
    expect(WidgetLoader.evaluateExpression(0, {})).toBe(0)
    expect(WidgetLoader.evaluateExpression(-5, {})).toBe(-5)
  })

  it('parses numeric string as number', () => {
    expect(WidgetLoader.evaluateExpression('100', {})).toBe(100)
    expect(WidgetLoader.evaluateExpression('-50', {})).toBe(-50)
  })

  it('resolves variable names', () => {
    const vars = { WINDOW_WIDTH: 1024, WINDOW_HEIGHT: 768 }
    expect(WidgetLoader.evaluateExpression('WINDOW_WIDTH', vars)).toBe(1024)
    expect(WidgetLoader.evaluateExpression('WINDOW_HEIGHT', vars)).toBe(768)
  })

  it('evaluates addition', () => {
    expect(WidgetLoader.evaluateExpression('10 + 5', {})).toBe(15)
    expect(WidgetLoader.evaluateExpression('WINDOW_WIDTH + 100', { WINDOW_WIDTH: 800 })).toBe(900)
  })

  it('evaluates subtraction', () => {
    expect(WidgetLoader.evaluateExpression('100 - 30', {})).toBe(70)
    expect(WidgetLoader.evaluateExpression('WINDOW_WIDTH - 200', { WINDOW_WIDTH: 1024 })).toBe(824)
  })

  it('evaluates multiplication', () => {
    expect(WidgetLoader.evaluateExpression('10 * 5', {})).toBe(50)
    expect(WidgetLoader.evaluateExpression('WIDTH * 2', { WIDTH: 100 })).toBe(200)
  })

  it('evaluates division (integer truncation)', () => {
    expect(WidgetLoader.evaluateExpression('100 / 3', {})).toBe(33)
    expect(WidgetLoader.evaluateExpression('10 / 4', {})).toBe(2)
  })

  it('handles division by zero (returns 0)', () => {
    expect(WidgetLoader.evaluateExpression('100 / 0', {})).toBe(0)
  })

  it('evaluates left-to-right (no operator precedence)', () => {
    // 2 + 3 * 4 = (2 + 3) * 4 = 20 in left-to-right, not 2 + 12 = 14
    expect(WidgetLoader.evaluateExpression('2 + 3 * 4', {})).toBe(20)
  })

  it('evaluates complex expressions', () => {
    const vars = { WINDOW_WIDTH: 1024, WIDTH: 200 }
    expect(WidgetLoader.evaluateExpression('WINDOW_WIDTH - WIDTH - 20', vars)).toBe(804)
  })

  it('returns 0 for unknown variable', () => {
    expect(WidgetLoader.evaluateExpression('UNKNOWN_VAR', {})).toBe(0)
  })

  it('handles multiple whitespace between tokens', () => {
    expect(WidgetLoader.evaluateExpression('100  +   50', {})).toBe(150)
  })
})

// ===========================================================================
// registerWidget
// ===========================================================================

describe('WidgetLoader.registerWidget', () => {
  it('registers a widget constructor', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)

    loader.registerWidget('Test', ContainerWidget)

    // Verify it was registered in the ObjectCreator
    expect(oc.getType('TestWidget')).toBe(ContainerWidget)
  })
})

// ===========================================================================
// loadLayout
// ===========================================================================

describe('WidgetLoader.loadLayout', () => {
  it('loads widget definitions from JSON', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)

    const layout: Record<string, WidgetDefinitionNode> = {
      'Container@MAIN_MENU': { Width: 800, Height: 600 },
      'Button@OK': { Width: 100, Height: 30 },
    }

    loader.loadLayout(layout)
    expect(loader.definitionCount).toBe(2)
    expect(loader.hasWidget('Container@MAIN_MENU')).toBe(true)
    expect(loader.hasWidget('Button@OK')).toBe(true)
  })

  it('throws on duplicate keys', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)

    loader.loadLayout({ 'Container@TEST': { Width: 100 } })
    expect(() =>
      loader.loadLayout({ 'Container@TEST': { Width: 200 } }),
    ).toThrow(/duplicate Key/)
  })

  it('registeredIds returns all definition keys', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)

    loader.loadLayout({
      'Container@A': {},
      'Container@B': {},
    })

    const ids = loader.registeredIds
    expect(ids).toContain('Container@A')
    expect(ids).toContain('Container@B')
  })
})

// ===========================================================================
// loadWidgetById
// ===========================================================================

describe('WidgetLoader.loadWidgetById', () => {
  it('throws for unknown widget id', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)

    expect(() => loader.loadWidgetById({}, null, 'Unknown@Widget')).toThrow(
      /Cannot find widget/,
    )
  })

  it('loads a simple widget by id', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)
    loader.registerWidget('Container', ContainerWidget)

    loader.loadLayout({
      'Container@test': { X: 10, Y: 20, Width: 300, Height: 200 },
    })

    const widget = loader.loadWidgetById({}, null, 'Container@test')
    expect(widget).toBeInstanceOf(ContainerWidget)
    expect(widget.id).toBe('test')
    expect(widget.bounds.x).toBe(10)
    expect(widget.bounds.y).toBe(20)
    expect(widget.bounds.width).toBe(300)
    expect(widget.bounds.height).toBe(200)
  })
})

// ===========================================================================
// loadWidget — Property Injection
// ===========================================================================

describe('WidgetLoader.loadWidget property injection', () => {
  it('injects X/Y/Width/Height as expressions', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)
    loader.registerWidget('Container', ContainerWidget)

    const node: WidgetDefinitionNode = {
      X: 100,
      Y: 200,
      Width: 400,
      Height: 300,
    }

    const widget = loader.loadWidget({}, null, 'Container@Test', node)
    expect(widget.bounds).toEqual({ x: 100, y: 200, width: 400, height: 300 })
  })

  it('injects Width/Height as expression strings', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)
    loader.registerWidget('Container', ContainerWidget)

    const node: WidgetDefinitionNode = {
      Width: 'WINDOW_WIDTH - 200',
      Height: 'WINDOW_HEIGHT - 100',
    }

    const widget = loader.loadWidget({}, null, 'Container@Test', node)
    expect(widget.bounds.width).toBe(1080) // 1280 - 200
    expect(widget.bounds.height).toBe(620) // 720 - 100
  })

  it('injects Visible as boolean', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)
    loader.registerWidget('Container', ContainerWidget)

    const hidden = loader.loadWidget(
      {},
      null,
      'Container@Hidden',
      { Visible: false },
    )
    expect(hidden.visible).toBe(false)

    const visible = loader.loadWidget(
      {},
      null,
      'Container@Visible',
      { Visible: true },
    )
    expect(visible.visible).toBe(true)
  })

  it('injects Visible as string "false" → false', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)
    loader.registerWidget('Container', ContainerWidget)

    const w = loader.loadWidget({}, null, 'Container@W', { Visible: 'false' as unknown as boolean })
    expect(w.visible).toBe(false)
  })

  it('injects IgnoreMouseOver', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)
    loader.registerWidget('Container', ContainerWidget)

    const w = loader.loadWidget(
      {},
      null,
      'Container@W',
      { IgnoreMouseOver: true },
    )
    expect(w.ignoreMouseOver).toBe(true)
  })

  it('injects IgnoreChildMouseOver', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)
    loader.registerWidget('Container', ContainerWidget)

    const w = loader.loadWidget(
      {},
      null,
      'Container@W',
      { IgnoreChildMouseOver: true },
    )
    expect(w.ignoreChildMouseOver).toBe(true)
  })
})

// ===========================================================================
// loadWidget — Children (recursive loading)
// ===========================================================================

describe('WidgetLoader.loadWidget Children', () => {
  it('recursively loads children', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)
    loader.registerWidget('Container', ContainerWidget)

    const node: WidgetDefinitionNode = {
      Width: 400,
      Height: 300,
      Children: {
        'Container@ChildA': { Width: 100, Height: 50 },
        'Container@ChildB': { Width: 100, Height: 50 },
      },
    }

    const widget = loader.loadWidget({}, null, 'Container@Parent', node)
    expect(widget.children.length).toBe(2)
    expect(widget.children[0].id).toBe('ChildA')
    expect(widget.children[1].id).toBe('ChildB')
  })

  it('children are attached to parent via addChild', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)
    loader.registerWidget('Container', ContainerWidget)

    const node: WidgetDefinitionNode = {
      Children: {
        'Container@Kid': { Width: 50, Height: 50 },
      },
    }

    const parent = loader.loadWidget({}, null, 'Container@Parent', node)
    const child = parent.children[0]
    expect(child.parent).toBe(parent)
  })

  it('loadWidget with explicit parent parameter attaches widget to parent', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)
    loader.registerWidget('Container', ContainerWidget)

    const parent = new ContainerWidget()
    const widget = loader.loadWidget(
      {},
      parent,
      'Container@Attached',
      { Width: 100, Height: 50 },
    )
    expect(parent.children).toContain(widget)
  })
})

// ===========================================================================
// loadWidget — Logic
// ===========================================================================

describe('WidgetLoader.loadWidget Logic', () => {
  it('sets widget.logic from Logic keys', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)
    loader.registerWidget('Container', ContainerWidget)

    const node: WidgetDefinitionNode = {
      Logic: {
        TestLogic: { param: 'value' },
        AnotherLogic: {},
      },
    }

    const w = loader.loadWidget({}, null, 'Container@W', node)
    expect(w.logic).toContain('TestLogic')
    expect(w.logic).toContain('AnotherLogic')
    expect(w.logic.length).toBe(2)
  })

  it('loadWidget passes logicArgs to postInit', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)
    loader.registerWidget('Container', ContainerWidget)

    const args: WidgetArgs = {}
    const node: WidgetDefinitionNode = {
      Logic: { MyLogic: { key: 'val' } },
    }

    const w = loader.loadWidget(args, null, 'Container@W', node)
    expect(w.postInitCalled).toBe(true)
  })

  it('loadWidget without Logic still calls postInit', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)
    loader.registerWidget('Container', ContainerWidget)

    const node: WidgetDefinitionNode = { Width: 100 }

    const w = loader.loadWidget({}, null, 'Container@W', node)
    expect(w.postInitCalled).toBe(true)
  })
})

// ===========================================================================
// loadUI
// ===========================================================================

describe('WidgetLoader.loadUI', () => {
  it('loadUI finds widget by name (ignoring type prefix)', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)
    loader.registerWidget('Container', ContainerWidget)

    loader.loadLayout({
      'Container@MAIN_MENU': { Width: 800, Height: 600 },
      'Container@SETTINGS': { Width: 600, Height: 400 },
    })

    const w = loader.loadUI('MAIN_MENU', {})
    expect(w).toBeInstanceOf(ContainerWidget)
    expect(w.id).toBe('MAIN_MENU')
    expect(w.bounds.width).toBe(800)
  })

  it('loadUI throws for unknown name', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)

    expect(() => loader.loadUI('NONEXISTENT', {})).toThrow(
      /Cannot find widget/,
    )
  })
})

// ===========================================================================
// Edge Cases
// ===========================================================================

describe('WidgetLoader edge cases', () => {
  it('throws for unregistered widget type', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)

    // Don't register anything — should fail
    loader.loadLayout({
      'UnknownType@W': { Width: 100 },
    })

    expect(() => loader.loadWidgetById({}, null, 'UnknownType@W')).toThrow(
      /type not registered/,
    )
  })

  it('loadWidget handles widget without @ (no id)', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)
    loader.registerWidget('Container', ContainerWidget)

    loader.loadLayout({
      'Container': { Width: 100, Height: 50 },
    })

    const w = loader.loadWidgetById({}, null, 'Container')
    expect(w).toBeInstanceOf(ContainerWidget)
    expect(w.id).toBe('') // No @ suffix → no id
  })

  it('loadWidget with explicit Id property overrides @-derived id', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)
    loader.registerWidget('Container', ContainerWidget)

    loader.loadLayout({
      'Container@original': { Id: 'override', Width: 100 },
    })

    const w = loader.loadWidgetById({}, null, 'Container@original')
    expect(w.id).toBe('override')
  })
})

// ===========================================================================
// Key Uniqueness by Suffix (MAJOR-10)
// ===========================================================================

describe('WidgetLoader key uniqueness by suffix', () => {
  it('detects duplicate Id suffix across different types', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)

    loader.loadLayout({ 'Container@MENU': {} })

    // Same suffix "MENU" under different type should throw
    expect(() =>
      loader.loadLayout({ 'ScrollPanel@MENU': {} }),
    ).toThrow(/duplicate Key/)
  })

  it('allows same type with different Id', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)

    expect(() =>
      loader.loadLayout({
        'Container@A': {},
        'Container@B': {},
      }),
    ).not.toThrow()
    expect(loader.definitionCount).toBe(2)
  })

  it('detects duplicate for key without @', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)

    loader.loadLayout({ 'Container': {} })
    // Same key without @ → duplicate
    expect(() =>
      loader.loadLayout({ 'Container': {} }),
    ).toThrow(/duplicate Key/)
  })
})

// ===========================================================================
// logicArgs Cleanup (MAJOR-6)
// ===========================================================================

describe('WidgetLoader logicArgs cleanup', () => {
  it('removes logicArgs from args after postInit', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)
    loader.registerWidget('Container', ContainerWidget)

    const args: WidgetArgs = { someKey: 'someValue' }
    const node: WidgetDefinitionNode = {
      Logic: { TestLogic: { param: 'test' } },
    }

    loader.loadWidget(args, null, 'Container@W', node)
    expect('logicArgs' in args).toBe(false)
    expect(args['logicArgs']).toBeUndefined()
    expect(args['someKey']).toBe('someValue') // other keys preserved
  })

  it('clears logicArgs even without Logic node', () => {
    const oc = makeObjectCreator()
    const loader = new WidgetLoader(oc)
    loader.registerWidget('Container', ContainerWidget)

    const args: WidgetArgs = {}
    const node: WidgetDefinitionNode = { Width: 100 }

    loader.loadWidget(args, null, 'Container@W', node)
    expect('logicArgs' in args).toBe(false)
  })
})
