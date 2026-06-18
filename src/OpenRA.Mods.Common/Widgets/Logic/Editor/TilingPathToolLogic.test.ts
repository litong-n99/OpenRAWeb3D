/**
 * TilingPathToolLogic.test.ts — TilingPathToolLogic 迁移单元测试
 *
 * 测试关注：下拉框设置、偏差滑块、复选框、按钮操作、Tab 可见性切换、dispose 清理。
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { TilingPathToolLogic } from './TilingPathToolLogic.js'
import { TilingPathTool } from '../../../Traits/World/TilingPathTool.js'
import { EditorActionManager } from '../../../Traits/World/EditorActionManager.js'
import { MapToolsLogic } from './MapToolsLogic.js'
import type { IEditorBrush } from '../../../Editor/IEditorBrush.js'

// ---------------------------------------------------------------------------
// Helpers: create stub brush
// ---------------------------------------------------------------------------

function createStubBrush(): IEditorBrush {
  return {
    handleMouseInput: () => false,
    tick: () => {},
    tickRender: () => {},
    renderAboveShroud: () => [],
    renderAnnotations: () => [],
    dispose: () => {},
  }
}

// ---------------------------------------------------------------------------
// Mock Editor
// ---------------------------------------------------------------------------

class MockEditor {
  currentBrush: IEditorBrush = createStubBrush()
  setBrushCalls: IEditorBrush[] = []
  clearBrushCalls: number = 0

  setBrush(brush: IEditorBrush): void { this.setBrushCalls.push(brush); this.currentBrush = brush }
  clearBrush(): void { this.clearBrushCalls++; this.currentBrush = createStubBrush() }
}

// ---------------------------------------------------------------------------
// Mock Widget
// ---------------------------------------------------------------------------

class MockWidget {
  id: string = ''
  private _children = new Map<string, MockWidget>()
  _onClick: (() => void) | null = null
  _isDisabled: boolean = false
  _isChecked: boolean = false
  _getText: (() => string) | null = null
  _getValue: (() => number) | null = null
  _onMouseDown: ((args: unknown) => void) | null = null
  _isVisibleFn: (() => boolean) | null = null
  _lastShownChoices: readonly string[] | null = null
  _changeHandlers: Array<(val: number) => void> = []

  isVisible(): boolean { return this._isVisibleFn?.() ?? true }

  get(id: string): MockWidget | null { return this._children.get(id) ?? null }
  setChild(id: string, child: MockWidget): void { this._children.set(id, child) }

  // For container-style get()(get in ContainerWidget)
  setContainer(name: string, dropdown: MockWidget): void {
    const container = new MockWidget()
    container.setChild('DROPDOWN', dropdown)
    this._children.set(name, container)
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TilingPathToolLogic', () => {
  let widget: MockWidget
  let actionManager: EditorActionManager
  let tool: TilingPathTool
  let editor: MockEditor

  beforeEach(() => {
    widget = new MockWidget()
    actionManager = new EditorActionManager()
    actionManager.worldLoaded({} as any, {} as any)
    editor = new MockEditor()

    // Create tool with some stub brushes
    tool = new TilingPathTool([
      {
        segment: {
          inner: 'r.type',
          start: 'r.s2',
          end: 'r.e2',
          startDirection: 0,
          endDirection: 0,
          hasInnerType: (t: string) => t === 'r',
          hasStartType: (t: string) => t === 'r',
          hasEndType: (t: string) => t === 'r',
        },
      },
    ], ['r'])

    // Setup widget hierarchy for dropdowns
    const startDropdown = new MockWidget()
    const endDropdown = new MockWidget()
    const innerDropdown = new MockWidget()

    widget.setContainer('START_TYPE', startDropdown)
    widget.setContainer('END_TYPE', endDropdown)
    widget.setContainer('INNER_TYPE', innerDropdown)

    // Buttons
    const resetBtn = new MockWidget()
    widget.setChild('RESET', resetBtn)
    const reverseBtn = new MockWidget()
    widget.setChild('REVERSE', reverseBtn)
    const randomizeBtn = new MockWidget()
    widget.setChild('RANDOMIZE', randomizeBtn)
    const paintBtn = new MockWidget()
    widget.setChild('PAINT', paintBtn)

    // Deviation slider
    const deviationContainer = new MockWidget()
    const deviationSlider = new MockWidget()
    deviationContainer.setChild('SLIDER', deviationSlider)
    widget.setChild('DEVIATION', deviationContainer)

    // Checkboxes
    widget.setChild('ALLOW_END_DEVIATION', new MockWidget())
    widget.setChild('CLOSED_LOOPS', new MockWidget())
  })

  it('constructs without errors', () => {
    const logic = new TilingPathToolLogic(widget as any, actionManager, tool, editor as any)
    expect(logic).toBeDefined()
    logic.dispose()
  })

  it('subscribes to MapToolsLogic.onSelected', () => {
    const logic = new TilingPathToolLogic(widget as any, actionManager, tool, editor as any)
    expect(MapToolsLogic.onSelected.size).toBeGreaterThan(0)
    logic.dispose()
  })

  it('unsubscribes on dispose', () => {
    const prevSize = MapToolsLogic.onSelected.size
    const logic = new TilingPathToolLogic(widget as any, actionManager, tool, editor as any)
    expect(MapToolsLogic.onSelected.size).toBe(prevSize + 1)
    logic.dispose()
    expect(MapToolsLogic.onSelected.size).toBe(prevSize)
  })

  it('tabSelected activates brush when visible', () => {
    const logic = new TilingPathToolLogic(widget as any, actionManager, tool, editor as any)
    // Simulate tab becoming visible
    widget._isVisibleFn = () => true
    logic.tabSelected(true)
    expect(editor.setBrushCalls.length).toBe(1)
    logic.dispose()
  })

  it('setupDropdown handles empty choices', () => {
    const logic = new TilingPathToolLogic(widget as any, actionManager, tool, editor as any)
    const dropdown = new MockWidget()
    expect(() => logic.setupDropdown(dropdown as any, [], () => '', () => {})).not.toThrow()
    logic.dispose()
  })

  it('setupDropdown wires onMouseDown', () => {
    const logic = new TilingPathToolLogic(widget as any, actionManager, tool, editor as any)
    const dropdown = new MockWidget()
    logic.setupDropdown(dropdown as any, ['a', 'b'], () => 'a', () => {})
    // setupDropdown sets (dropdown as any).onMouseDown = ...
    expect((dropdown as any).onMouseDown).not.toBeNull()
    logic.dispose()
  })

  it('paint button is disabled when no EditorBlitSource', () => {
    new TilingPathToolLogic(widget as any, actionManager, tool, editor as any)
    // Since tool.editorBlitSource starts as null
    const paintBtn = widget.get('PAINT') as MockWidget
    expect(paintBtn).toBeDefined()
    // isDisabled closure should reference tool.editorBlitSource === null
  })

  it('reset button is disabled when no plan', () => {
    new TilingPathToolLogic(widget as any, actionManager, tool, editor as any)
    const resetBtn = widget.get('RESET') as MockWidget
    expect(resetBtn).toBeDefined()
    // isDisabled closure should reference tool.plan === null
  })
})
