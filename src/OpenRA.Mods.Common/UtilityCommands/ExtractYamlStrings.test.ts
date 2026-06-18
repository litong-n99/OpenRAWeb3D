/**
 * ExtractYamlStrings.test.ts — ExtractYamlStrings 迁移单元测试
 *
 * 测试焦点: actor 名称转换、字符串提取算法、FTL 输出生成
 */

import { describe, it, expect } from 'vitest'
import {
  ExtractYamlStringsCommand,
  toLowerActor,
  toLower,
  extractFromActor,
  groupYamlCandidates,
  generateYamlFtlOutput,
  type YamlStringNode,
  type YamlExtractionCandidate,
} from './ExtractYamlStrings'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExtractYamlStringsCommand', () => {
  it('has correct command name', () => {
    const cmd = new ExtractYamlStringsCommand()
    expect(cmd.name).toBe('--extract-yaml-strings')
  })

  describe('validateArguments', () => {
    it('accepts no extra args', () => {
      const cmd = new ExtractYamlStringsCommand()
      expect(cmd.validateArguments(['--extract-yaml-strings'])).toBe(true)
    })

    it('accepts one map arg', () => {
      const cmd = new ExtractYamlStringsCommand()
      expect(cmd.validateArguments(['--extract-yaml-strings', 'map.oramap'])).toBe(true)
    })

    it('rejects more than one extra arg', () => {
      const cmd = new ExtractYamlStringsCommand()
      expect(cmd.validateArguments(['--extract-yaml-strings', 'a', 'b'])).toBe(false)
    })
  })

  describe('run', () => {
    it('executes without throwing with no args', () => {
      const cmd = new ExtractYamlStringsCommand()
      const mockUtility = {
        modData: { modFiles: {}, mapCache: {}, manifest: { id: 'test' } },
        mods: new Map(),
      }
      expect(() => cmd.run(mockUtility as any, ['--extract-yaml-strings'])).not.toThrow()
    })

    it('executes without throwing with map path', () => {
      const cmd = new ExtractYamlStringsCommand()
      const mockUtility = {
        modData: { modFiles: {}, mapCache: {}, manifest: { id: 'test' } },
        mods: new Map(),
      }
      expect(() => cmd.run(mockUtility as any, ['--extract-yaml-strings', 'map.oramap'])).not.toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// toLowerActor
// ---------------------------------------------------------------------------

describe('toLowerActor', () => {
  it('converts basic actor name', () => {
    expect(toLowerActor('E1')).toBe('actor-e1')
  })

  it('handles meta actors (^ prefix)', () => {
    expect(toLowerActor('^Vehicle')).toBe('meta-vehicle')
  })

  it('handles dotted actor names', () => {
    expect(toLowerActor('HARV.Player')).toBe('actor-harv-player')
  })

  it('handles underscore names', () => {
    expect(toLowerActor('BAD_GUY')).toBe('actor-bad-guy')
  })

  it('lowercases everything', () => {
    expect(toLowerActor('MiXeD')).toBe('actor-mixed')
  })
})

// ---------------------------------------------------------------------------
// toLower
// ---------------------------------------------------------------------------

describe('toLower', () => {
  it('converts PascalCase to kebab-case', () => {
    expect(toLower('TooltipName')).toBe('tooltip-name')
  })

  it('converts CamelCase to kebab-case', () => {
    expect(toLower('maxHealth')).toBe('max-health')
  })

  it('handles single words', () => {
    expect(toLower('name')).toBe('name')
  })

  it('handles empty string', () => {
    expect(toLower('')).toBe('')
  })

  it('converts consecutive uppercase', () => {
    expect(toLower('XMLParser')).toBe('x-m-l-parser')
  })
})

// ---------------------------------------------------------------------------
// extractFromActor
// ---------------------------------------------------------------------------

describe('extractFromActor', () => {
  function makeNode(key: string, value: string, nodes?: YamlStringNode[]): YamlStringNode {
    return { key, value: { value, nodes } }
  }

  it('extracts strings from actor traits', () => {
    const actor = makeNode('E1', '', [
      makeNode('Tooltip', '', [
        makeNode('Name', 'Rifle Infantry'),
      ]),
    ])

    const traitInfos = new Map<string, readonly string[]>([
      ['Tooltip', ['Name']],
    ])

    const candidates: YamlExtractionCandidate[] = []
    extractFromActor(actor, traitInfos, candidates)

    expect(candidates.length).toBe(1)
    expect(candidates[0]!.actor).toBe('actor-e1')
    expect(candidates[0]!.value).toBe('Rifle Infantry')
  })

  it('handles Buildable trait specially', () => {
    const actor = makeNode('MCV', '', [
      makeNode('Buildable', '', [
        makeNode('Description', 'Mobile Construction Vehicle'),
      ]),
    ])

    const traitInfos = new Map<string, readonly string[]>([
      ['Buildable', ['Description']],
    ])

    const candidates: YamlExtractionCandidate[] = []
    extractFromActor(actor, traitInfos, candidates)

    expect(candidates.length).toBe(1)
    expect(candidates[0]!.key).toBe(toLower('Description'))
  })

  it('handles Encyclopedia trait specially', () => {
    const actor = makeNode('FACT', '', [
      makeNode('Encyclopedia', '', [
        makeNode('Description', 'Produces vehicles'),
      ]),
    ])

    const traitInfos = new Map<string, readonly string[]>([
      ['Encyclopedia', ['Description']],
    ])

    const candidates: YamlExtractionCandidate[] = []
    extractFromActor(actor, traitInfos, candidates)

    expect(candidates.length).toBe(1)
    expect(candidates[0]!.key).toBe(toLower('Encyclopedia'))
  })

  it('handles Tooltip with suffix', () => {
    const actor = makeNode('TANK', '', [
      makeNode('Tooltip@production', '', [
        makeNode('Name', 'Medium Tank'),
      ]),
    ])

    const traitInfos = new Map<string, readonly string[]>([
      ['Tooltip', ['Name']],
    ])

    const candidates: YamlExtractionCandidate[] = []
    extractFromActor(actor, traitInfos, candidates)

    expect(candidates.length).toBe(1)
    expect(candidates[0]!.key).toContain('production')
  })

  it('skips non-existent trait fields', () => {
    const actor = makeNode('E1', '', [
      makeNode('Tooltip', '', [
        makeNode('UnknownField', 'Should be ignored'),
      ]),
    ])

    const traitInfos = new Map<string, readonly string[]>([
      ['Tooltip', ['Name']], // 'UnknownField' not registered
    ])

    const candidates: YamlExtractionCandidate[] = []
    extractFromActor(actor, traitInfos, candidates)

    expect(candidates.length).toBe(0)
  })

  it('skips already-extracted values', () => {
    const actor = makeNode('E1', '', [
      makeNode('Tooltip', '', [
        makeNode('Name', 'actor-e1-name'),
      ]),
    ])

    const traitInfos = new Map<string, readonly string[]>([
      ['Tooltip', ['Name']],
    ])

    const candidates: YamlExtractionCandidate[] = []
    extractFromActor(actor, traitInfos, candidates)

    // 'actor-e1-name' is already a fluent key reference -> skipped
    expect(candidates.length).toBe(0)
  })

  it('skips empty values', () => {
    const actor = makeNode('E1', '', [
      makeNode('Tooltip', '', [
        makeNode('Name', ''),
      ]),
    ])

    const traitInfos = new Map<string, readonly string[]>([
      ['Tooltip', ['Name']],
    ])

    const candidates: YamlExtractionCandidate[] = []
    extractFromActor(actor, traitInfos, candidates)

    expect(candidates.length).toBe(0)
  })

  it('handles general traits with suffix', () => {
    const actor = makeNode('UNIT', '', [
      makeNode('GrantCondition@deploy', '', [
        makeNode('Description', 'Deploy to gain armor'),
      ]),
    ])

    const traitInfos = new Map<string, readonly string[]>([
      ['GrantCondition', ['Description']],
    ])

    const candidates: YamlExtractionCandidate[] = []
    extractFromActor(actor, traitInfos, candidates)

    expect(candidates.length).toBe(1)
    expect(candidates[0]!.key).toContain('deploy')
  })

  it('handles \\n replacement', () => {
    const actor = makeNode('UNIT', '', [
      makeNode('Tooltip', '', [
        makeNode('Description', 'Line 1\\nLine 2'),
      ]),
    ])

    const traitInfos = new Map<string, readonly string[]>([
      ['Tooltip', ['Description']],
    ])

    const candidates: YamlExtractionCandidate[] = []
    extractFromActor(actor, traitInfos, candidates)

    expect(candidates.length).toBe(1)
    expect(candidates[0]!.value).toContain('Line 1')
    expect(candidates[0]!.value).toContain('Line 2')
    expect(candidates[0]!.value).not.toContain('\\n')
  })
})

// ---------------------------------------------------------------------------
// groupYamlCandidates
// ---------------------------------------------------------------------------

describe('groupYamlCandidates', () => {
  it('groups by rule file', () => {
    const c1: YamlExtractionCandidate = {
      filename: 'infantry.yaml',
      actor: 'actor-e1',
      key: 'name',
      value: 'Rifle Infantry',
      nodes: [],
    }
    const c2: YamlExtractionCandidate = {
      filename: 'infantry.yaml',
      actor: 'actor-e2',
      key: 'name',
      value: 'Grenadier',
      nodes: [],
    }

    const groups = groupYamlCandidates([c1, c2])
    expect(groups.length).toBe(1)
    expect(groups[0]!.candidates.length).toBe(2)
  })

  it('merges duplicate actor+key+value candidates', () => {
    const c1: YamlExtractionCandidate = {
      filename: 'a.yaml',
      actor: 'actor-e1',
      key: 'name',
      value: 'Rifle',
      nodes: [],
    }
    const c2: YamlExtractionCandidate = {
      filename: 'b.yaml',
      actor: 'actor-e1',
      key: 'name',
      value: 'Rifle',
      nodes: [],
    }

    const groups = groupYamlCandidates([c1, c2])
    expect(groups.length).toBe(1)
    expect(groups[0]!.candidates.length).toBe(1)
    expect(groups[0]!.ruleFiles.has('a.yaml')).toBe(true)
    expect(groups[0]!.ruleFiles.has('b.yaml')).toBe(true)
  })

  it('handles null filename', () => {
    const c: YamlExtractionCandidate = {
      filename: null,
      actor: 'actor-test',
      key: 'name',
      value: 'Test',
      nodes: [],
    }
    const groups = groupYamlCandidates([c])
    expect(groups.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// generateYamlFtlOutput
// ---------------------------------------------------------------------------

describe('generateYamlFtlOutput', () => {
  it('generates FTL output with actor grouping', () => {
    const groups = [{
      ruleFiles: new Set(['infantry.yaml']),
      candidates: [
        {
          filename: 'infantry.yaml',
          actor: 'actor-e1',
          key: 'name',
          value: 'Rifle Infantry',
          nodes: [],
        },
      ],
    }]

    const output = generateYamlFtlOutput(groups)
    expect(output).toContain('## infantry.yaml')
    expect(output).toContain('actor-e1-name = Rifle Infantry')
  })

  it('merges multi-attribute entries under same actor', () => {
    const groups = [{
      ruleFiles: new Set(['vehicles.yaml']),
      candidates: [
        {
          filename: 'vehicles.yaml',
          actor: 'actor-mtnk',
          key: 'name',
          value: 'Medium Tank',
          nodes: [],
        },
        {
          filename: 'vehicles.yaml',
          actor: 'actor-mtnk',
          key: 'description',
          value: 'Main battle tank',
          nodes: [],
        },
      ],
    }]

    const output = generateYamlFtlOutput(groups)
    expect(output).toContain('name =')
    expect(output).toContain('.name = Medium Tank')
    expect(output).toContain('.description = Main battle tank')
  })

  it('handles briefing key specially', () => {
    const groups = [{
      ruleFiles: new Set(['mission.yaml']),
      candidates: [
        {
          filename: 'mission.yaml',
          actor: 'actor-world',
          key: 'missiondata-briefing',
          value: 'Eliminate all enemy forces.',
          nodes: [],
        },
      ],
    }]

    const output = generateYamlFtlOutput(groups)
    // 'actor-world-missiondata-briefing' should become 'briefing'
    expect(output).toContain('briefing = Eliminate all enemy forces.')
  })

  it('handles empty groups', () => {
    const output = generateYamlFtlOutput([])
    expect(output).toBe('')
  })

  it('includes FTL comment header', () => {
    const groups = [{
      ruleFiles: new Set(['test.yaml']),
      candidates: [
        {
          filename: 'test.yaml',
          actor: 'actor-test',
          key: 'title',
          value: 'Test Entry',
          nodes: [],
        },
      ],
    }]
    const output = generateYamlFtlOutput(groups)
    expect(output.startsWith('## test.yaml')).toBe(true)
  })
})
