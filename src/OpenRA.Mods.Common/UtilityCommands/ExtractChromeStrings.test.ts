/**
 * ExtractChromeStrings.test.ts — ExtractChromeStrings 迁移单元测试
 *
 * 测试焦点: 字符串提取算法、命名清理、FTL 输出生成
 */

import { describe, it, expect } from 'vitest'
import {
  ExtractChromeStringsCommand,
  clearContainersAndToLower,
  clearTypesAndToLower,
  isAlreadyExtracted,
  fromChromeLayout,
  groupChromeCandidates,
  generateFtlOutput,
  type ChromeYamlNode,
  type ExtractionCandidate,
} from './ExtractChromeStrings'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExtractChromeStringsCommand', () => {
  it('has correct command name', () => {
    const cmd = new ExtractChromeStringsCommand()
    expect(cmd.name).toBe('--extract-chrome-strings')
  })

  describe('validateArguments', () => {
    it('always returns true', () => {
      const cmd = new ExtractChromeStringsCommand()
      expect(cmd.validateArguments([])).toBe(true)
      expect(cmd.validateArguments(['--extract-chrome-strings'])).toBe(true)
      expect(cmd.validateArguments(['--extract-chrome-strings', 'extra'])).toBe(true)
    })
  })

  describe('run', () => {
    it('executes without throwing (stub mode)', () => {
      const cmd = new ExtractChromeStringsCommand()
      const mockUtility = {
        modData: { modFiles: {}, mapCache: {}, manifest: { id: 'test' } },
        mods: new Map(),
      }
      expect(() => cmd.run(mockUtility as any, [])).not.toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// clearContainersAndToLower
// ---------------------------------------------------------------------------

describe('clearContainersAndToLower', () => {
  it('removes "Background"', () => {
    expect(clearContainersAndToLower('MainMenuBackground')).toBe('mainmenu')
  })

  it('removes "Container"', () => {
    expect(clearContainersAndToLower('ButtonContainer')).toBe('button')
  })

  it('removes "Panel"', () => {
    expect(clearContainersAndToLower('OptionsPanel')).toBe('options')
  })

  it('removes "headers"', () => {
    expect(clearContainersAndToLower('ColumnHeadersWidget')).toBe('columnwidget')
  })

  it('handles multiple patterns', () => {
    expect(clearContainersAndToLower('MainBackgroundContainer')).toBe('main')
  })

  it('converts to lowercase', () => {
    expect(clearContainersAndToLower('UPPERCASE')).toBe('uppercase')
  })
})

// ---------------------------------------------------------------------------
// clearTypesAndToLower
// ---------------------------------------------------------------------------

describe('clearTypesAndToLower', () => {
  it('replaces LabelForInput with Label', () => {
    expect(clearTypesAndToLower('LabelForInputWidget')).toBe('labelwidget')
  })

  it('replaces DropdownButton with Dropdown', () => {
    expect(clearTypesAndToLower('DropdownButtonWidget')).toBe('dropdownwidget')
  })

  it('replaces MenuButton with Button', () => {
    expect(clearTypesAndToLower('MenuButtonWidget')).toBe('buttonwidget')
  })

  it('replaces WorldButton with Button', () => {
    expect(clearTypesAndToLower('WorldButtonWidget')).toBe('buttonwidget')
  })

  it('replaces ProductionTypeButton with Button', () => {
    expect(clearTypesAndToLower('ProductionTypeButtonWidget')).toBe('buttonwidget')
  })
})

// ---------------------------------------------------------------------------
// isAlreadyExtracted
// ---------------------------------------------------------------------------

describe('isAlreadyExtracted', () => {
  it('returns true for simple fluent key', () => {
    expect(isAlreadyExtracted('button-label')).toBe(true)
  })

  it('returns true for dotted fluent key', () => {
    expect(isAlreadyExtracted('main-menu.title')).toBe(true)
  })

  it('returns false for display text with spaces', () => {
    expect(isAlreadyExtracted('Click to Start')).toBe(false)
  })

  it('returns false for text with uppercase', () => {
    expect(isAlreadyExtracted('ButtonLabel')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isAlreadyExtracted('')).toBe(false)
  })

  it('returns false for string with special chars', () => {
    expect(isAlreadyExtracted('Hello World!')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// fromChromeLayout
// ---------------------------------------------------------------------------

describe('fromChromeLayout', () => {
  function makeNode(
    key: string,
    value: string,
    nodes?: ChromeYamlNode[],
  ): ChromeYamlNode {
    return {
      key,
      value: { value, nodes },
      children: nodes,
    }
  }

  it('extracts translatable text from widget nodes', () => {
    const node = makeNode('Button@MainMenu', '', [
      makeNode('Text', 'Start Game'),
    ])

    const widgetInfos = new Map<string, readonly string[]>([
      ['Button', ['Text']],
    ])

    const candidates: ExtractionCandidate[] = []
    fromChromeLayout(node, widgetInfos, null, candidates)

    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates.some((c) => c.value === 'Start Game')).toBe(true)
  })

  it('skips already-extracted values', () => {
    const node = makeNode('Button@MainMenu', '', [
      makeNode('Text', 'button-label'),
    ])

    const widgetInfos = new Map<string, readonly string[]>([
      ['Button', ['Text']],
    ])

    const candidates: ExtractionCandidate[] = []
    fromChromeLayout(node, widgetInfos, null, candidates)

    // 'button-label' is already extracted -> no candidates
    const hasTextCandidate = candidates.some(
      (c) => c.key === 'Text' || c.value === 'button-label',
    )
    expect(hasTextCandidate).toBe(false)
  })

  it('skips empty values', () => {
    const node = makeNode('Label@Header', '', [
      makeNode('Text', ''),
    ])

    const widgetInfos = new Map<string, readonly string[]>([
      ['Label', ['Text']],
    ])

    const candidates: ExtractionCandidate[] = []
    fromChromeLayout(node, widgetInfos, null, candidates)

    expect(candidates.length).toBe(0)
  })

  it('recurses into Children nodes', () => {
    const root = makeNode('Container@Main', '', [
      makeNode('Children', '', [
        makeNode('Button@Sub', '', [
          makeNode('Text', 'Click Me'),
        ]),
      ]),
    ])

    const widgetInfos = new Map<string, readonly string[]>([
      ['Button', ['Text']],
    ])

    const candidates: ExtractionCandidate[] = []
    fromChromeLayout(root, widgetInfos, null, candidates)

    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates[0]!.value).toBe('Click Me')
  })

  it('sets container context from Background/Container nodes', () => {
    // Background contains Children -> Button child structure
    const node = makeNode('Background@MainBackground', '', [
      makeNode('Children', '', [
        makeNode('Button@SubButton', '', [
          makeNode('Text', 'Hello'),
        ]),
      ]),
    ])

    // Container is set from Background@MainBackground, then recursed
    const widgetInfos = new Map<string, readonly string[]>([
      ['Background', []],
      ['Button', ['Text']],
    ])

    const candidates: ExtractionCandidate[] = []
    fromChromeLayout(node, widgetInfos, null, candidates)

    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates[0]!.value).toBe('Hello')
    // Key should include container context
    expect(candidates[0]!.key).toContain('button')
  })

  it('preserves \\n to indented newlines', () => {
    const node = makeNode('Label@Desc', '', [
      makeNode('Text', 'Line1\\nLine2'),
    ])

    const widgetInfos = new Map<string, readonly string[]>([
      ['Label', ['Text']],
    ])

    const candidates: ExtractionCandidate[] = []
    fromChromeLayout(node, widgetInfos, null, candidates)

    expect(candidates.length).toBe(1)
    expect(candidates[0]!.value).toContain('Line1')
    expect(candidates[0]!.value).toContain('Line2')
    expect(candidates[0]!.value).not.toContain('\\n') // converted
  })

  it('replaces { } with < > in values', () => {
    const node = makeNode('Label@Title', '', [
      makeNode('Text', 'Hello {name}'),
    ])

    const widgetInfos = new Map<string, readonly string[]>([
      ['Label', ['Text']],
    ])

    const candidates: ExtractionCandidate[] = []
    fromChromeLayout(node, widgetInfos, null, candidates)

    expect(candidates.length).toBe(1)
    expect(candidates[0]!.value).toContain('<name>')
    expect(candidates[0]!.value).not.toContain('{')
  })
})

// ---------------------------------------------------------------------------
// groupChromeCandidates
// ---------------------------------------------------------------------------

describe('groupChromeCandidates', () => {
  it('groups candidates by chrome file', () => {
    const c1: ExtractionCandidate = {
      chrome: 'mainmenu.yaml',
      key: 'button-start',
      type: 'text',
      value: 'Start',
      nodes: [],
    }
    const c2: ExtractionCandidate = {
      chrome: 'mainmenu.yaml',
      key: 'button-exit',
      type: 'text',
      value: 'Exit',
      nodes: [],
    }

    const groups = groupChromeCandidates([c1, c2])
    expect(groups.length).toBe(1)
    expect(groups[0]!.candidates.length).toBe(2)
  })

  it('merges duplicate candidates from different files', () => {
    const c1: ExtractionCandidate = {
      chrome: 'file_a.yaml',
      key: 'button-start',
      type: 'text',
      value: 'Start',
      nodes: [],
    }
    const c2: ExtractionCandidate = {
      chrome: 'file_b.yaml',
      key: 'button-start',
      type: 'text',
      value: 'Start',
      nodes: [],
    }

    const groups = groupChromeCandidates([c1, c2])
    // Should merge into one group with both files
    expect(groups.length).toBe(1)
    expect(groups[0]!.candidates.length).toBe(1)
    expect(groups[0]!.chromeFiles.has('file_a.yaml')).toBe(true)
    expect(groups[0]!.chromeFiles.has('file_b.yaml')).toBe(true)
  })

  it('handles null chrome value', () => {
    const c: ExtractionCandidate = {
      chrome: null,
      key: 'test-key',
      type: 'label',
      value: 'Test',
      nodes: [],
    }
    const groups = groupChromeCandidates([c])
    expect(groups.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// generateFtlOutput
// ---------------------------------------------------------------------------

describe('generateFtlOutput', () => {
  it('generates FTL with single-string entries', () => {
    const groups = [{
      chromeFiles: new Set(['main.yaml']),
      candidates: [
        {
          chrome: 'main.yaml',
          key: 'button',
          type: 'text',
          value: 'Start Game',
          nodes: [],
        },
      ],
    }]
    const output = generateFtlOutput(groups)
    expect(output).toContain('## main.yaml')
    expect(output).toContain('button = Start Game')
  })

  it('generates FTL with multi-attribute entries', () => {
    const groups = [{
      chromeFiles: new Set(['dialog.yaml']),
      candidates: [
        {
          chrome: 'dialog.yaml',
          key: 'confirm-dialog',
          type: 'label',
          value: 'Confirm?',
          nodes: [],
        },
        {
          chrome: 'dialog.yaml',
          key: 'confirm-dialog',
          type: 'tooltip',
          value: 'Click to confirm',
          nodes: [],
        },
      ],
    }]
    const output = generateFtlOutput(groups)
    expect(output).toContain('## dialog.yaml')
    expect(output).toContain('confirm-dialog =')
    expect(output).toContain('.label = Confirm?')
    expect(output).toContain('.tooltip = Click to confirm')
  })

  it('handles type=text as label in multi-attribute groups', () => {
    const groups = [{
      chromeFiles: new Set(['panel.yaml']),
      candidates: [
        {
          chrome: 'panel.yaml',
          key: 'test-key',
          type: 'text',
          value: 'Text value',
          nodes: [],
        },
        {
          chrome: 'panel.yaml',
          key: 'test-key',
          type: 'tooltip',
          value: 'Tooltip value',
          nodes: [],
        },
      ],
    }]
    const output = generateFtlOutput(groups)
    // In multi-attribute mode, text becomes label
    expect(output).toContain('.label = Text value')
    expect(output).toContain('.tooltip = Tooltip value')
  })

  it('handles empty candidate list gracefully', () => {
    const output = generateFtlOutput([])
    expect(output).toBe('')
  })
})
