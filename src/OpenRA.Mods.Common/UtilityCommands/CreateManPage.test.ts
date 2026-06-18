/**
 * CreateManPage.test.ts — CreateManPage unit tests
 *
 * Tests: IUtilityCommand contract, troff man page generation, field formatting,
 * section headers, footer, launch fields, edge cases.
 *
 * Pure logic tests — no Babylon.js, no WebGL.
 */

import { describe, it, expect } from 'vitest'
import { CreateManPage } from './CreateManPage.js'
import type { IUtilityCommand } from '../../OpenRA.Game/IUtilityCommand.js'
import type { SettingsSection, SettingsFieldDescriptor } from './Documentation/DocumentationHelpers.js'

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

// ---------------------------------------------------------------------------
// IUtilityCommand contract
// ---------------------------------------------------------------------------

describe('CreateManPage — IUtilityCommand contract', () => {
  const command = new CreateManPage([], [])

  it('should have correct name', () => {
    const cmd: IUtilityCommand = command
    expect(cmd.name).toBe('--man-page')
  })

  it('should always validate arguments', () => {
    expect(command.validateArguments([])).toBe(true)
    expect(command.validateArguments(['extra'])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Troff generation: header and footer
// ---------------------------------------------------------------------------

describe('CreateManPage — header and footer', () => {
  it('should produce .TH header', () => {
    const cmd = new CreateManPage([], [])
    const result = cmd.generateManPage()
    expect(result).toContain('.TH OPENRA 6')
  })

  it('should produce NAME section', () => {
    const cmd = new CreateManPage([], [])
    const result = cmd.generateManPage()
    expect(result).toContain('.SH NAME')
    expect(result).toContain('openra \\-')
  })

  it('should produce SYNOPSIS section', () => {
    const cmd = new CreateManPage([], [])
    const result = cmd.generateManPage()
    expect(result).toContain('.SH SYNOPSIS')
    expect(result).toContain('.B openra')
  })

  it('should produce DESCRIPTION section', () => {
    const cmd = new CreateManPage([], [])
    const result = cmd.generateManPage()
    expect(result).toContain('.SH DESCRIPTION')
    expect(result).toContain('starts the game.')
  })

  it('should produce OPTIONS section', () => {
    const cmd = new CreateManPage([], [])
    const result = cmd.generateManPage()
    expect(result).toContain('.SH OPTIONS')
  })

  it('should produce FILES section', () => {
    const cmd = new CreateManPage([], [])
    const result = cmd.generateManPage()
    expect(result).toContain('.SH FILES')
    expect(result).toContain('~/.openra')
  })

  it('should produce BUGS section', () => {
    const cmd = new CreateManPage([], [])
    const result = cmd.generateManPage()
    expect(result).toContain('.SH BUGS')
    expect(result).toContain('bugs.openra.net')
  })

  it('should produce COPYRIGHT section', () => {
    const cmd = new CreateManPage([], [])
    const result = cmd.generateManPage()
    expect(result).toContain('.SH COPYRIGHT')
    expect(result).toContain('GNU GPL v3')
  })

  it('should produce output ending with newline', () => {
    const cmd = new CreateManPage([], [])
    const result = cmd.generateManPage()
    expect(result.endsWith('\n')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Troff field formatting
// ---------------------------------------------------------------------------

describe('CreateManPage — field formatting', () => {
  it('should output .TP for each field', () => {
    const sections = [
      makeSection('Sound', [
        makeField({ name: 'Volume', descriptionLines: ['Master volume.'], defaultValue: '100' }),
      ]),
    ]
    const cmd = new CreateManPage(sections, [])
    const result = cmd.generateManPage()

    expect(result).toContain('.TP')
    expect(result).toContain('.BR Sound.Volume=')
  })

  it('should include default value in italic for non-boolean values', () => {
    const sections = [
      makeSection('Sound', [
        makeField({ name: 'Volume', descriptionLines: ['Volume level.'], defaultValue: '100' }),
      ]),
    ]
    const cmd = new CreateManPage(sections, [])
    const result = cmd.generateManPage()

    expect(result).toContain('\\fI100\\fR')
  })

  it('should NOT italicize boolean True default value', () => {
    const sections = [
      makeSection('Graphics', [
        makeField({ name: 'VSync', descriptionLines: ['VSync mode.'], defaultValue: 'True' }),
      ]),
    ]
    const cmd = new CreateManPage(sections, [])
    const result = cmd.generateManPage()

    expect(result).not.toContain('\\fITrue\\fR')
  })

  it('should NOT italicize boolean False default value', () => {
    const sections = [
      makeSection('Graphics', [
        makeField({ name: 'Fullscreen', descriptionLines: ['Fullscreen mode.'], defaultValue: 'False' }),
      ]),
    ]
    const cmd = new CreateManPage(sections, [])
    const result = cmd.generateManPage()

    expect(result).not.toContain('\\fIFalse\\fR')
  })

  it('should NOT italicize System-prefixed default values', () => {
    const sections = [
      makeSection('Test', [
        makeField({
          name: 'SysField',
          descriptionLines: ['System field.'],
          defaultValue: 'System.Object',
        }),
      ]),
    ]
    const cmd = new CreateManPage(sections, [])
    const result = cmd.generateManPage()

    expect(result).not.toContain('\\fISystem.Object\\fR')
  })

  it('should output description lines after field', () => {
    const sections = [
      makeSection('Sound', [
        makeField({
          name: 'Volume',
          descriptionLines: ['Line 1', 'Line 2'],
          defaultValue: '50',
        }),
      ]),
    ]
    const cmd = new CreateManPage(sections, [])
    const result = cmd.generateManPage()

    expect(result).toContain('Line 1')
    expect(result).toContain('Line 2')
  })

  it('should handle multiple sections', () => {
    const sections = [
      makeSection('Sound', [makeField({ name: 'Volume', defaultValue: '100' })]),
      makeSection('Graphics', [makeField({ name: 'Width', defaultValue: '1024' })]),
    ]
    const cmd = new CreateManPage(sections, [])
    const result = cmd.generateManPage()

    expect(result).toContain('.BR Sound.Volume=')
    expect(result).toContain('.BR Graphics.Width=')
  })
})

// ---------------------------------------------------------------------------
// Launch fields
// ---------------------------------------------------------------------------

describe('CreateManPage — launch fields', () => {
  it('should include Launch fields', () => {
    const launchFields = [
      makeField({ name: 'Game.Mod', descriptionLines: ['Mod to load.'], defaultValue: 'ra' }),
    ]
    const cmd = new CreateManPage([], launchFields)
    const result = cmd.generateManPage()

    expect(result).toContain('.BR Launch.Game.Mod=')
    expect(result).toContain('\\fIra\\fR')
  })

  it('should not include Launch section when empty', () => {
    const cmd = new CreateManPage([], [])
    const result = cmd.generateManPage()

    const beforeFooter = result.indexOf('.SH FILES')
    const optionsSection = result.indexOf('.SH OPTIONS')
    // Between OPTIONS and FILES there should be no Launch fields
    const middle = result.substring(optionsSection, beforeFooter)
    expect(middle).not.toContain('Launch')
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('CreateManPage — edge cases', () => {
  it('should handle empty sections gracefully', () => {
    const cmd = new CreateManPage([], [])
    const result = cmd.generateManPage()
    // Should still have all structural sections
    expect(result).toContain('.TH OPENRA 6')
    expect(result).toContain('.SH NAME')
    expect(result).toContain('.SH OPTIONS')
    expect(result).toContain('.SH FILES')
    expect(result).toContain('.SH BUGS')
    expect(result).toContain('.SH COPYRIGHT')
  })

  it('should handle field with null default value', () => {
    const sections = [
      makeSection('Test', [
        makeField({
          name: 'NullField',
          descriptionLines: ['No default.'],
          defaultValue: null,
        }),
      ]),
    ]
    const cmd = new CreateManPage(sections, [])
    const result = cmd.generateManPage()

    // Should still have .TP and field name but no italicized value
    expect(result).toContain('.TP')
    expect(result).toContain('.BR Test.NullField=')
  })

  it('should handle field with empty description', () => {
    const sections = [
      makeSection('Test', [
        makeField({
          name: 'NoDesc',
          descriptionLines: [],
          defaultValue: '1',
        }),
      ]),
    ]
    const cmd = new CreateManPage(sections, [])
    const result = cmd.generateManPage()

    expect(result).toContain('.BR Test.NoDesc=')
    // No description lines to follow
  })
})
