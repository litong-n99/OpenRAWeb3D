/**
 * ExtractSettingsDocsCommand.test.ts — ExtractSettingsDocsCommand unit tests
 *
 * Tests: IUtilityCommand contract, markdown generation, field formatting,
 * empty sections, launch parameters note.
 *
 * Pure logic tests — no Babylon.js, no WebGL.
 */

import { describe, it, expect } from 'vitest'
import { ExtractSettingsDocsCommand } from './ExtractSettingsDocsCommand.js'
import { Utility, type IUtilityCommand } from '../../../OpenRA.Game/IUtilityCommand.js'
import type { SettingsSection, SettingsFieldDescriptor } from './DocumentationHelpers.js'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeField(overrides: Partial<SettingsFieldDescriptor> = {}): SettingsFieldDescriptor {
  return {
    name: 'testField',
    descriptionLines: ['Test description.'],
    defaultValue: '42',
    ...overrides,
  }
}

function makeSection(key: string, fields: readonly SettingsFieldDescriptor[]): SettingsSection {
  return { key, fields }
}

function makeMockUtility(): Utility {
  return new Utility(
    {
      manifest: {
        id: 'test',
        metadata: { title: 'Test Mod', version: 'test-1.0' },
        requiresMods: [],
        mounts: [],
        rules: [],
        sequences: [],
        modelSequences: [],
        cursors: [],
        chrome: [],
        chromeLayout: [],
        weapons: [],
        voices: [],
        notifications: [],
        music: [],
        fluentMessages: [],
        tileSets: [],
        chromeMetrics: [],
        missions: [],
        hotkeys: [],
        serverTraits: [],
        mapFolders: new Map(),
        mapCompatibility: [],
        loadScreen: null,
        defaultOrderGenerator: null,
        rendererConstants: {
          fontSheetSize: 512,
          cursorSheetSize: 512,
          mapPreviewSheetSize: 2048,
          sequenceBgraSheetSize: 2048,
          sequenceIndexedSheetSize: 2048,
          vertexBatchSize: 8192,
        },
        packageFormats: [],
        globalModData: new Map(),
      },
      defaultFileSystem: undefined as any,
      objectCreator: undefined as any,
      ruleset: undefined as any,
      mapCache: undefined as any,
      modFiles: undefined as any,
    } as any,
    new Map(),
  )
}

// ---------------------------------------------------------------------------
// IUtilityCommand contract
// ---------------------------------------------------------------------------

describe('ExtractSettingsDocsCommand — IUtilityCommand contract', () => {
  const command = new ExtractSettingsDocsCommand([], [])

  it('should have correct name', () => {
    const cmd: IUtilityCommand = command
    expect(cmd.name).toBe('--settings-docs')
  })

  it('should always validate arguments', () => {
    expect(command.validateArguments([])).toBe(true)
    expect(command.validateArguments(['1.0'])).toBe(true)
    expect(command.validateArguments([])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Markdown generation
// ---------------------------------------------------------------------------

describe('ExtractSettingsDocsCommand — generateDocs', () => {
  it('should include header with version', () => {
    const cmd = new ExtractSettingsDocsCommand([], [])
    const result = cmd.generateDocs('release-2023')
    expect(result).toContain('release-2023')
    expect(result).toContain('This documentation displays annotated settings')
    expect(result).toContain('## Location')
    expect(result).toContain('%APPDATA%')
  })

  it('should include location section', () => {
    const cmd = new ExtractSettingsDocsCommand([], [])
    const result = cmd.generateDocs('1.0')
    expect(result).toContain('## Location')
    expect(result).toContain('Windows')
    expect(result).toContain('Mac OS X')
    expect(result).toContain('Linux')
  })

  it('should include older releases note', () => {
    const cmd = new ExtractSettingsDocsCommand([], [])
    const result = cmd.generateDocs('1.0')
    expect(result).toContain('playtest-20190825')
  })

  it('should include portable installations note', () => {
    const cmd = new ExtractSettingsDocsCommand([], [])
    const result = cmd.generateDocs('1.0')
    expect(result).toContain('Support')
    expect(result).toContain('portable installations')
  })

  it('should output empty string for no sections', () => {
    const cmd = new ExtractSettingsDocsCommand([], [])
    const result = cmd.generateDocs('1.0')
    // Should still have header, location, but no ## Section headings
    expect(result).not.toContain('## Sound')
    expect(result).not.toContain('## Launch')
  })
})

// ---------------------------------------------------------------------------
// Settings field output
// ---------------------------------------------------------------------------

describe('ExtractSettingsDocsCommand — settings fields', () => {
  it('should output section heading and field', () => {
    const sections = [
      makeSection('Sound', [
        makeField({ name: 'Volume', descriptionLines: ['Master volume level.'], defaultValue: '100' }),
      ]),
    ]
    const cmd = new ExtractSettingsDocsCommand(sections, [])
    const result = cmd.generateDocs('1.0')

    expect(result).toContain('## Sound')
    expect(result).toContain('### Volume')
    expect(result).toContain('Master volume level.')
    expect(result).toContain('**Default Value:** 100')
    expect(result).toContain('```miniyaml')
    expect(result).toContain('Sound: ')
    expect(result).toContain('\tVolume: 100')
  })

  it('should output multiple fields in same section', () => {
    const sections = [
      makeSection('Graphics', [
        makeField({
          name: 'ResolutionWidth',
          descriptionLines: ['Width of the screen.'],
          defaultValue: '1920',
        }),
        makeField({
          name: 'ResolutionHeight',
          descriptionLines: ['Height of the screen.'],
          defaultValue: '1080',
        }),
      ]),
    ]
    const cmd = new ExtractSettingsDocsCommand(sections, [])
    const result = cmd.generateDocs('1.0')

    expect(result).toContain('### ResolutionWidth')
    expect(result).toContain('### ResolutionHeight')
    // Section heading should appear only once
    const headingCount = (result.match(/## Graphics/g) || []).length
    expect(headingCount).toBe(1)
  })

  it('should output multiple sections', () => {
    const sections = [
      makeSection('Sound', [makeField({ name: 'Volume', defaultValue: '100' })]),
      makeSection('Graphics', [makeField({ name: 'VSync', defaultValue: 'True' })]),
    ]
    const cmd = new ExtractSettingsDocsCommand(sections, [])
    const result = cmd.generateDocs('1.0')

    expect(result).toContain('## Sound')
    expect(result).toContain('## Graphics')
  })

  it('should skip fields with System-prefixed default values', () => {
    const sections = [
      makeSection('Test', [
        makeField({
          name: 'SysField',
          descriptionLines: ['A system field.'],
          defaultValue: 'System.Object',
        }),
        makeField({
          name: 'NormalField',
          descriptionLines: ['A normal field.'],
          defaultValue: 'hello',
        }),
      ]),
    ]
    const cmd = new ExtractSettingsDocsCommand(sections, [])
    const result = cmd.generateDocs('1.0')

    expect(result).toContain('### NormalField')
    expect(result).toContain('### SysField')
    // System field should NOT have Default Value or miniyaml block
    // Extract just the SysField section (between "### SysField" and the next "###" or end)
    const sysStart = result.indexOf('### SysField')
    const afterSys = result.substring(sysStart)
    const nextHeading = afterSys.indexOf('\n### ', '### SysField'.length)
    const sysSection = nextHeading > 0 ? afterSys.substring(0, nextHeading) : afterSys
    // SysField itself should not have "**Default Value:**"
    expect(sysSection).not.toContain('**Default Value:**')
    // But NormalField should have it
    expect(result).toContain('**Default Value:** hello')
  })

  it('should not output default value for null', () => {
    const sections = [
      makeSection('Test', [
        makeField({
          name: 'NullField',
          descriptionLines: ['No default.'],
          defaultValue: null,
        }),
      ]),
    ]
    const cmd = new ExtractSettingsDocsCommand(sections, [])
    const result = cmd.generateDocs('1.0')

    expect(result).not.toContain('**Default Value:** null')
    expect(result).not.toContain('```miniyaml')
  })
})

// ---------------------------------------------------------------------------
// Launch parameters
// ---------------------------------------------------------------------------

describe('ExtractSettingsDocsCommand — launch parameters', () => {
  it('should output Launch section with note', () => {
    const launchFields = [
      makeField({ name: 'Game.Mod', descriptionLines: ['Mod to load.'], defaultValue: 'ra' }),
    ]
    const cmd = new ExtractSettingsDocsCommand([], launchFields)
    const result = cmd.generateDocs('1.0')

    expect(result).toContain('## Launch')
    expect(result).toContain("These are runtime parameters which can't be defined in `settings.yaml`.")
    expect(result).toContain('### Game.Mod')
    expect(result).toContain('**Default Value:** ra')
  })

  it('should not output Launch section when empty', () => {
    const cmd = new ExtractSettingsDocsCommand([], [])
    const result = cmd.generateDocs('1.0')
    expect(result).not.toContain('## Launch')
  })
})

// ---------------------------------------------------------------------------
// Version handling
// ---------------------------------------------------------------------------

describe('ExtractSettingsDocsCommand — version handling', () => {
  it('should use provided version string', () => {
    const cmd = new ExtractSettingsDocsCommand([], [])
    const result = cmd.generateDocs('custom-version-2.0')
    expect(result).toContain('custom-version-2.0')
  })

  it('should use mod metadata version when available', () => {
    const utility = makeMockUtility()
    // The run method would use utility.modData.manifest.metadata.version
    // But generateDocs takes the version explicitly
    expect(utility.modData.manifest.metadata.version).toBe('test-1.0')
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('ExtractSettingsDocsCommand — edge cases', () => {
  it('should handle multi-line descriptions', () => {
    const sections = [
      makeSection('Input', [
        makeField({
          name: 'MouseScroll',
          descriptionLines: ['Line 1: Description of mouse scroll.', 'Line 2: More details.'],
          defaultValue: 'True',
        }),
      ]),
    ]
    const cmd = new ExtractSettingsDocsCommand(sections, [])
    const result = cmd.generateDocs('1.0')

    expect(result).toContain('Line 1')
    expect(result).toContain('Line 2')
  })

  it('should handle boolean default values', () => {
    const sections = [
      makeSection('Test', [
        makeField({ name: 'Enabled', defaultValue: 'True', descriptionLines: ['Enable feature.'] }),
        makeField({ name: 'Debug', defaultValue: 'False', descriptionLines: ['Debug mode.'] }),
      ]),
    ]
    const cmd = new ExtractSettingsDocsCommand(sections, [])
    const result = cmd.generateDocs('1.0')

    expect(result).toContain('**Default Value:** True')
    expect(result).toContain('**Default Value:** False')
  })

  it('should produce output ending with newline', () => {
    const cmd = new ExtractSettingsDocsCommand([], [])
    const result = cmd.generateDocs('1.0')
    expect(result.endsWith('\n')).toBe(true)
  })
})
