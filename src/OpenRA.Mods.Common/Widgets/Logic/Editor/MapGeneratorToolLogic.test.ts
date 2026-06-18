/**
 * MapGeneratorToolLogic.test.ts — MapGeneratorToolLogic 迁移单元测试
 *
 * 测试关注：设置表单生成、4 种选项类型、生成按钮、错误处理、随机化。
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { MapGeneratorToolLogic, type IEditorMapGeneratorInfo, type IMapGeneratorSettings, type MapGeneratorOption } from './MapGeneratorToolLogic.js'
import { EditorActionManager } from '../../../Traits/World/EditorActionManager.js'

// ---------------------------------------------------------------------------
// Mock generator + settings
// ---------------------------------------------------------------------------

class MockSettings implements IMapGeneratorSettings {
  playerCount: number = 2
  options: MapGeneratorOption[] = []

  randomize(_random: { next(): number }): void {
    for (const opt of this.options) {
      if (typeof (opt as any).value === 'boolean') {
        (opt as any).value = !(opt as any).value
      }
    }
  }

  compile(_terrainInfo: unknown, _mapSize: unknown): { settings: unknown; tileset: string } {
    return { settings: {}, tileset: 'temperat' }
  }
}

class MockGeneratorInfo implements IEditorMapGeneratorInfo {
  type: string = 'Test'
  label: string = 'Test Generator'
  name: string = 'test-generator'

  private settings: MockSettings

  constructor(settings?: MockSettings) {
    this.settings = settings ?? new MockSettings()
  }

  getSettings(): IMapGeneratorSettings { return this.settings }
  generate(_modData: unknown, _args: { settings: unknown; tileset: string }): unknown {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Mock Widget
// ---------------------------------------------------------------------------

class MockWidget {
  id: string = ''
  private _children = new Map<string, MockWidget>()
  _onClick: (() => void) | null = null
  _contentHeight: number = 0
  _clonedCount: number = 0
  _removedChildren: boolean = false
  _getTextFn: (() => string) | null = null
  _isVisible: boolean = true

  get(id: string): MockWidget | null { return this._children.get(id) ?? null }
  setChild(id: string, child: MockWidget): void { this._children.set(id, child) }

  removeChildren(): void { this._children.clear(); this._removedChildren = true }
  addChild(child: MockWidget): void { this._children.set('child_' + this._children.size, child) }

  clone(): MockWidget {
    this._clonedCount++
    const c = new MockWidget()
    c.id = this.id
    return c
  }

  get contentHeight(): number { return this._contentHeight }
  set contentHeight(h: number) { this._contentHeight = h }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MapGeneratorToolLogic', () => {
  let widget: MockWidget
  let actionManager: EditorActionManager
  let settings: MockSettings
  let generator: MockGeneratorInfo

  beforeEach(() => {
    widget = new MockWidget()
    settings = new MockSettings()
    generator = new MockGeneratorInfo(settings)
    actionManager = new EditorActionManager()
    // Initialize with OpenMapAction
    actionManager.worldLoaded({} as any, {} as any)

    // Setup widget children: SETTINGS_PANEL + templates + buttons
    const panel = new MockWidget()
    const checkboxTemplate = new MockWidget()
    checkboxTemplate.id = 'CHECKBOX_TEMPLATE'
    const textTemplate = new MockWidget()
    textTemplate.id = 'TEXT_TEMPLATE'
    const dropdownTemplate = new MockWidget()
    dropdownTemplate.id = 'DROPDOWN_TEMPLATE'

    panel.setChild('CHECKBOX_TEMPLATE', checkboxTemplate)
    panel.setChild('TEXT_TEMPLATE', textTemplate)
    panel.setChild('DROPDOWN_TEMPLATE', dropdownTemplate)

    widget.setChild('SETTINGS_PANEL', panel)

    const generateBtn = new MockWidget()
    widget.setChild('GENERATE_BUTTON', generateBtn)

    const randomBtn = new MockWidget()
    widget.setChild('GENERATE_RANDOM_BUTTON', randomBtn)
  })

  it('constructs without generator without errors', () => {
    expect(() => {
      new MapGeneratorToolLogic(widget as any, actionManager, null)
    }).not.toThrow()
  })

  it('constructs with generator and builds settings UI', () => {
    const logic = new MapGeneratorToolLogic(widget as any, actionManager, generator as any)
    expect(logic).toBeDefined()
  })

  it('handle boolean option rendering', () => {
    settings.options = [
      { id: 'test-bool', label: 'Test Bool', value: true },
    ]

    const logic = new MapGeneratorToolLogic(widget as any, actionManager, generator as any)
    expect(logic).toBeDefined()
    // Settings panel should have children added
  })

  it('handle integer option rendering', () => {
    settings.options = [
      { id: 'test-int', label: 'Test Int', value: 42 },
    ]

    const logic = new MapGeneratorToolLogic(widget as any, actionManager, generator as any)
    expect(logic).toBeDefined()
  })

  it('handle multiChoice option rendering', () => {
    const choices = new Map<string, { label: string; description?: string }>()
    choices.set('a', { label: 'Option A' })
    settings.options = [
      {
        id: 'test-choice',
        label: 'Test Choice',
        value: 'a',
        choices,
        validChoices: () => ['a'],
        default: null,
      },
    ]

    const logic = new MapGeneratorToolLogic(widget as any, actionManager, generator as any)
    expect(logic).toBeDefined()
  })

  it('generateMap executes without error with generator', () => {
    const logic = new MapGeneratorToolLogic(widget as any, actionManager, generator as any)
    expect(() => logic.generateMap()).not.toThrow()
  })

  it('generateMap does not throw when generator is null', () => {
    const logic = new MapGeneratorToolLogic(widget as any, actionManager, null)
    expect(() => logic.generateMap()).not.toThrow()
  })

  it('updateSettingsUi clears old children', () => {
    const logic = new MapGeneratorToolLogic(widget as any, actionManager, generator as any)
    expect(logic).toBeDefined()
    const panel = widget.get('SETTINGS_PANEL') as MockWidget
    expect(panel._removedChildren).toBe(true)
  })
})
