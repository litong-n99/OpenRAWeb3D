/**
 * miniyaml-to-json.test.ts -- MiniYAML to JSON converter unit tests
 *
 * Tests focus on: parsing correctness, edge cases, inheritance resolution,
 * Vite plugin behavior, and OpenRA MiniYAML feature parity.
 */

import { describe, it, expect } from 'vitest'
import {
  MiniYamlParser,
  miniYamlPlugin,
  isMiniYamlFile,
  MiniYamlParseError,
} from './miniyaml-to-json'

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/** Create a parser with default options. */
function p(input: string): unknown {
  return new MiniYamlParser().parse(input)
}

/** Create a parser with inheritance disabled. */
function pNoInherit(input: string): unknown {
  return new MiniYamlParser({ resolveInherits: false }).parse(input)
}

// ---------------------------------------------------------------------------
// 1. Basic key-value parsing
// ---------------------------------------------------------------------------

describe('basic key-value parsing', () => {
  it('parses simple key-value pair', () => {
    const result = p('Key: Value') as Record<string, unknown>
    expect(result.Key).toBe('Value')
  })

  it('parses multiple key-value pairs', () => {
    const result = p('Key1: Value1\nKey2: Value2') as Record<string, unknown>
    expect(result.Key1).toBe('Value1')
    expect(result.Key2).toBe('Value2')
  })

  it('parses key with empty value', () => {
    const result = p('Key:') as Record<string, unknown>
    expect(result.Key).toBeNull()
  })

  it('parses key without colon as key with null value', () => {
    const result = p('Key') as Record<string, unknown>
    expect(result.Key).toBeNull()
  })

  it('parses value with spaces', () => {
    const result = p('Key: Hello World') as Record<string, unknown>
    expect(result.Key).toBe('Hello World')
  })

  it('parses numeric values as strings', () => {
    const result = p('HP: 40000') as Record<string, unknown>
    expect(result.HP).toBe('40000')
  })

  it('parses values with commas', () => {
    const result = p('TerrainTypes: Clear,Road,Rough') as Record<string, unknown>
    expect(result.TerrainTypes).toBe('Clear,Road,Rough')
  })

  it('handles leading/trailing whitespace on lines', () => {
    const result = p('  Key: Value  ') as Record<string, unknown>
    expect(result.Key).toBe('Value')
  })
})

// ---------------------------------------------------------------------------
// 2. Nested structure
// ---------------------------------------------------------------------------

describe('nested structure', () => {
  it('parses single-level nesting with tabs', () => {
    const input = 'Parent:\n\tChild: Value'
    const result = p(input) as Record<string, unknown>
    expect(result.Parent).toEqual({ Child: 'Value' })
  })

  it('parses single-level nesting with spaces', () => {
    const input = 'Parent:\n    Child: Value'
    const result = p(input) as Record<string, unknown>
    expect(result.Parent).toEqual({ Child: 'Value' })
  })

  it('parses deep nesting', () => {
    const input = 'A:\n\tB:\n\t\tC:\n\t\t\tD: Value'
    const result = p(input) as Record<string, unknown>
    expect(result.A).toEqual({ B: { C: { D: 'Value' } } })
  })

  it('parses multiple children at same level', () => {
    const input = 'Parent:\n\tChild1: Value1\n\tChild2: Value2'
    const result = p(input) as Record<string, unknown>
    expect(result.Parent).toEqual({ Child1: 'Value1', Child2: 'Value2' })
  })

  it('parses sibling nodes at top level', () => {
    const input = 'Node1:\n\tA: 1\nNode2:\n\tB: 2'
    const result = p(input) as Record<string, unknown>
    expect(result.Node1).toEqual({ A: '1' })
    expect(result.Node2).toEqual({ B: '2' })
  })

  it('parses mixed tabs and spaces indentation', () => {
    const input = 'Root:\n    Child1:\n        Attr: Test\n\tChild2:\n\t\tAttr: Test'
    const result = p(input) as Record<string, unknown>
    expect(result.Root).toBeDefined()
    const root = result.Root as Record<string, unknown>
    expect(root.Child1).toEqual({ Attr: 'Test' })
    expect(root.Child2).toEqual({ Attr: 'Test' })
  })

  it('parses node with both value and children', () => {
    const input = 'Node: value\n\tChild: childValue'
    const result = p(input) as Record<string, unknown>
    expect(result.Node).toEqual({ __value: 'value', Child: 'childValue' })
  })
})

// ---------------------------------------------------------------------------
// 3. @-named nodes
// ---------------------------------------------------------------------------

describe('@-named nodes', () => {
  it('parses Key@Name with value', () => {
    const result = p('Key@Name: Value') as Record<string, unknown>
    expect(result.Key).toEqual({ id: 'Name', value: 'Value' })
  })

  it('parses Key@Name without value', () => {
    const result = p('Key@Name:') as Record<string, unknown>
    expect(result.Key).toEqual({ id: 'Name' })
  })

  it('parses multiple @-named nodes with same base key', () => {
    const input = 'Key@First: Value1\nKey@Second: Value2'
    const result = p(input) as Record<string, unknown>
    expect(result.Key).toEqual([
      { id: 'First', value: 'Value1' },
      { id: 'Second', value: 'Value2' },
    ])
  })

  it('parses @-named node with children', () => {
    const input = 'Trait@Name: Value\n\tChild: childValue'
    const result = p(input) as Record<string, unknown>
    expect(result.Trait).toEqual({
      id: 'Name',
      value: 'Value',
      Child: 'childValue',
    })
  })

  it('parses Inherits@label syntax', () => {
    const result = p('Inherits@a: ^Base') as Record<string, unknown>
    expect(result.Inherits).toEqual({ id: 'a', value: '^Base' })
  })
})

// ---------------------------------------------------------------------------
// 4. -TraitName removal
// ---------------------------------------------------------------------------

describe('-TraitName removal', () => {
  it('parses removal marker', () => {
    const result = p('-ExternalCapturable:') as Record<string, unknown>
    expect(result.ExternalCapturable).toEqual({ __remove: true })
  })

  it('parses removal marker with value', () => {
    const result = p('-TraitName: someValue') as Record<string, unknown>
    expect(result.TraitName).toEqual({ __remove: true })
  })

  it('parses multiple removals', () => {
    const input = '-Trait1:\n-Trait2:'
    const result = p(input) as Record<string, unknown>
    expect(result.Trait1).toEqual({ __remove: true })
    expect(result.Trait2).toEqual({ __remove: true })
  })
})

// ---------------------------------------------------------------------------
// 5. Comments
// ---------------------------------------------------------------------------

describe('comments', () => {
  it('strips inline comments', () => {
    const result = p('Key: Value # this is a comment') as Record<string, unknown>
    expect(result.Key).toBe('Value')
  })

  it('ignores comment-only lines', () => {
    const input = '# Comment line\nKey: Value'
    const result = p(input) as Record<string, unknown>
    expect(result.Key).toBe('Value')
  })

  it('handles comment with no space after hash', () => {
    const result = p('Key: Value#comment') as Record<string, unknown>
    expect(result.Key).toBe('Value')
  })

  it('handles empty comment', () => {
    const result = p('Key: #') as Record<string, unknown>
    expect(result.Key).toBeNull()
  })

  it('ignores multiple comment lines', () => {
    const input = '# Comment 1\n# Comment 2\n# Comment 3\nKey: Value'
    const result = p(input) as Record<string, unknown>
    expect(result.Key).toBe('Value')
  })

  it('strips comments from nested lines', () => {
    const input = 'Parent:\n\tChild: Value # comment'
    const result = p(input) as Record<string, unknown>
    expect(result.Parent).toEqual({ Child: 'Value' })
  })
})

// ---------------------------------------------------------------------------
// 6. Empty values
// ---------------------------------------------------------------------------

describe('empty values', () => {
  it('parses Key: as null', () => {
    const result = p('Key:') as Record<string, unknown>
    expect(result.Key).toBeNull()
  })

  it('parses standalone key as null', () => {
    const result = p('Key') as Record<string, unknown>
    expect(result.Key).toBeNull()
  })

  it('parses nested empty value', () => {
    const input = 'Parent:\n\tChild:'
    const result = p(input) as Record<string, unknown>
    expect(result.Parent).toEqual({ Child: null })
  })

  it('parses multiple empty values', () => {
    const input = 'A:\nB:\nC:'
    const result = p(input) as Record<string, unknown>
    expect(result.A).toBeNull()
    expect(result.B).toBeNull()
    expect(result.C).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 7. Arrays
// ---------------------------------------------------------------------------

describe('arrays', () => {
  it('parses array with dash-prefixed items', () => {
    const input = 'Items:\n\t- Item1\n\t- Item2'
    const result = p(input) as Record<string, unknown>
    expect(result.Items).toEqual(['Item1', 'Item2'])
  })

  it('parses value-only children as object keys', () => {
    // In MiniYAML, lines without colons are keys with null values
    const input = 'Items:\n\tValue1\n\tValue2'
    const result = p(input) as Record<string, unknown>
    expect(result.Items).toEqual({ Value1: null, Value2: null })
  })

  it('parses empty array container', () => {
    const input = 'Items:'
    const result = p(input) as Record<string, unknown>
    expect(result.Items).toBeNull()
  })

  it('parses array items with children', () => {
    const input = 'Items:\n\t- Item1:\n\t\tProp: Val'
    const result = p(input) as Record<string, unknown>
    expect(result.Items).toEqual([{ name: 'Item1', Prop: 'Val' }])
  })

  it('parses array items with values and children', () => {
    // In MiniYAML, "- Item1: value" means dash-item with key "Item1" and value "value"
    // The children are separate nested entries
    const input = 'Items:\n\t- Item1: value\n\t\tProp: Val'
    const result = p(input) as Record<string, unknown>
    expect(result.Items).toEqual([{ name: 'Item1', value: 'value', Prop: 'Val' }])
  })

  it('parses mixed dash and non-dash children as object', () => {
    // When children are a mix of dashed and keyed, treat as object
    const input = 'List:\n\t- First\n\t- Second\n\tOther: Value'
    const result = p(input) as Record<string, unknown>
    // Not a pure array: mixed dash and regular children
    expect(result.List).toBeDefined()
    const list = result.List as Record<string, unknown>
    // Dashed items with space keep the dash in the key when not in array context
    expect(list['- First']).toBeNull()
    expect(list['- Second']).toBeNull()
    expect(list.Other).toBe('Value')
  })
})

// ---------------------------------------------------------------------------
// 8. Inheritance merging
// ---------------------------------------------------------------------------

describe('inheritance merging', () => {
  it('merges inherited parent properties', () => {
    const input =
      '^Base:\n\tKey1: value1\nChild:\n\tInherits: ^Base\n\tKey2: value2'
    const result = p(input) as Record<string, unknown>
    expect(result.Child).toEqual({
      Key1: 'value1',
      Key2: 'value2',
    })
  })

  it('child overrides parent value', () => {
    const input =
      '^Base:\n\tKey1: baseValue\nChild:\n\tInherits: ^Base\n\tKey1: childValue'
    const result = p(input) as Record<string, unknown>
    expect(result.Child).toEqual({ Key1: 'childValue' })
  })

  it('inherits from multiple parents', () => {
    const input =
      '^BaseA:\n\tA: 1\n^BaseB:\n\tB: 2\nChild:\n\tInherits@a: ^BaseA\n\tInherits@b: ^BaseB\n\tC: 3'
    const result = p(input) as Record<string, unknown>
    expect(result.Child).toEqual({ A: '1', B: '2', C: '3' })
  })

  it('removes inherited property', () => {
    const input =
      '^Base:\n\tKey1: value1\nChild:\n\tInherits: ^Base\n\t-Key1:'
    const result = p(input) as Record<string, unknown>
    expect(result.Child).toEqual({})
  })

  it('removes and re-adds inherited property', () => {
    const input =
      '^Base:\n\tKey1: value1\nChild:\n\tInherits: ^Base\n\t-Key1:\n\tKey1: newValue'
    const result = p(input) as Record<string, unknown>
    expect(result.Child).toEqual({ Key1: 'newValue' })
  })

  it('deep merge of nested inherited properties', () => {
    const input =
      '^Base:\n\tSection:\n\t\tA: 1\n\t\tB: 2\nChild:\n\tInherits: ^Base\n\tSection:\n\t\tB: 3\n\t\tC: 4'
    const result = p(input) as Record<string, unknown>
    expect(result.Child).toEqual({
      Section: { A: '1', B: '3', C: '4' },
    })
  })

  it('skips inheritance resolution when disabled', () => {
    const input =
      '^Base:\n\tKey1: value1\nChild:\n\tInherits: ^Base\n\tKey2: value2'
    const result = pNoInherit(input) as Record<string, unknown>
    expect(result.Child).toEqual({
      Inherits: '^Base',
      Key2: 'value2',
    })
  })
})

// ---------------------------------------------------------------------------
// 9. Block scalars / multi-line values
// ---------------------------------------------------------------------------

describe('multi-line and special values', () => {
  it('parses value with escaped hash', () => {
    const result = p('Key: before \\# after') as Record<string, unknown>
    expect(result.Key).toBe('before # after')
  })

  it('parses value with multiple escaped hashes', () => {
    const result = p('Key: \\#start \\#end') as Record<string, unknown>
    expect(result.Key).toBe('#start #end')
  })

  it('parses value ending with escaped hash', () => {
    const result = p('Key: value\\#') as Record<string, unknown>
    expect(result.Key).toBe('value#')
  })
})

// ---------------------------------------------------------------------------
// 10. Complex real-world MiniYAML
// ---------------------------------------------------------------------------

describe('complex real-world MiniYAML', () => {
  it('parses building definition', () => {
    const input = `^BasicBuilding:
\tInherits: ^Building
\tBuilding:
\t\tFootprint: xx xx
\t\tDimensions: 2,1
\t\tTerrainTypes: Clear,Road,Rough
\tHealth:
\t\tHP: 40000
\tRevealsShroud:
\t\tRange: 4c0
\t\tType: CenterPosition
\tArmor:
\t\tType: wood
\tWithBuildingBomber:
\t\tWithSpriteBody@DAMAGE:
\t-ExternalCapturable:`

    const result = p(input) as Record<string, unknown>
    expect(result['^BasicBuilding']).toBeDefined()
    const building = result['^BasicBuilding'] as Record<string, unknown>

    expect(building.Inherits).toBe('^Building')
    expect(building.Building).toEqual({
      Footprint: 'xx xx',
      Dimensions: '2,1',
      TerrainTypes: 'Clear,Road,Rough',
    })
    expect(building.Health).toEqual({ HP: '40000' })
    expect(building.RevealsShroud).toEqual({
      Range: '4c0',
      Type: 'CenterPosition',
    })
    expect(building.Armor).toEqual({ Type: 'wood' })
    expect(building.WithBuildingBomber).toBeDefined()
    expect(building.ExternalCapturable).toEqual({ __remove: true })
  })

  it('parses actor with multiple traits', () => {
    const input = `E1:
\tInherits: ^Soldier
\tBuildable:
\t\tQueue: Infantry
\t\tBuildPaletteOrder: 10
\tValued:
\t\tCost: 100
\tHealth:
\t\tHP: 5000
\tMobile:
\t\tSpeed: 50
\tArmament@PRIMARY:
\t\tWeapon: M1Carbine
\tArmament@SECONDARY:
\t\tWeapon: Grenade`

    const result = p(input) as Record<string, unknown>
    expect(result.E1).toBeDefined()
    const e1 = result.E1 as Record<string, unknown>

    expect(e1.Inherits).toBe('^Soldier')
    expect(e1.Buildable).toEqual({ Queue: 'Infantry', BuildPaletteOrder: '10' })
    expect(e1.Valued).toEqual({ Cost: '100' })
    expect(e1.Health).toEqual({ HP: '5000' })
    expect(e1.Mobile).toEqual({ Speed: '50' })

    // Armament@PRIMARY and Armament@SECONDARY should be array
    expect(e1.Armament).toBeDefined()
    const armaments = e1.Armament as Array<Record<string, unknown>>
    expect(Array.isArray(armaments)).toBe(true)
    expect(armaments.length).toBe(2)
    expect(armaments[0]).toEqual({ id: 'PRIMARY', Weapon: 'M1Carbine' })
    expect(armaments[1]).toEqual({ id: 'SECONDARY', Weapon: 'Grenade' })
  })

  it('parses weapon definition', () => {
    const input = `M1Carbine:
\tReloadDelay: 20
\tRange: 3c0
\tReport: gun11.aud
\tProjectile: Bullet
\t\tSpeed: 1c682
\tWarhead@1Dam: SpreadDamage
\t\tSpread: 128
\t\tDamage: 1500
\t\tVersus:
\t\t\tNone: 100
\t\t\tWood: 60
\t\t\tLight: 40
\t\t\tHeavy: 25
\tWarhead@2Smu: LeaveSmudge`

    const result = p(input) as Record<string, unknown>
    expect(result.M1Carbine).toBeDefined()
    const weapon = result.M1Carbine as Record<string, unknown>

    expect(weapon.ReloadDelay).toBe('20')
    expect(weapon.Range).toBe('3c0')
    expect(weapon.Report).toBe('gun11.aud')
    expect(weapon.Projectile).toEqual({
      __value: 'Bullet',
      Speed: '1c682',
    })

    expect(weapon.Warhead).toBeDefined()
    const warheads = weapon.Warhead as Array<Record<string, unknown>>
    expect(Array.isArray(warheads)).toBe(true)
    expect(warheads.length).toBe(2)
    expect(warheads[0]).toEqual({
      id: '1Dam',
      value: 'SpreadDamage',
      Spread: '128',
      Damage: '1500',
      Versus: {
        None: '100',
        Wood: '60',
        Light: '40',
        Heavy: '25',
      },
    })
    expect(warheads[1]).toEqual({
      id: '2Smu',
      value: 'LeaveSmudge',
    })
  })
})

// ---------------------------------------------------------------------------
// 11. Error handling
// ---------------------------------------------------------------------------

describe('error handling', () => {
  it('throws on bad indentation (skipping levels)', () => {
    const input = 'Root:\n\t\tChild: Value'
    expect(() => p(input)).toThrow(MiniYamlParseError)
  })

  it('error includes line number', () => {
    const input = 'Root:\n\n\t\tChild: Value'
    try {
      p(input)
      expect.fail('Should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(MiniYamlParseError)
      expect((e as MiniYamlParseError).line).toBe(3)
    }
  })

  it('parseFile throws in browser environment', async () => {
    const parser = new MiniYamlParser()
    await expect(parser.parseFile('test.yaml')).rejects.toThrow(MiniYamlParseError)
  })
})

// ---------------------------------------------------------------------------
// 12. Special characters and escaping
// ---------------------------------------------------------------------------

describe('special characters and escaping', () => {
  it('handles colon in value (not as key separator)', () => {
    const result = p('Key: a:b:c') as Record<string, unknown>
    expect(result.Key).toBe('a:b:c')
  })

  it('handles value with equals sign', () => {
    const result = p('Key: a=b') as Record<string, unknown>
    expect(result.Key).toBe('a=b')
  })

  it('handles value with special chars', () => {
    const result = p('Key: !@$%^*()') as Record<string, unknown>
    expect(result.Key).toBe('!@$%^*()')
  })

  it('handles unicode in values', () => {
    const result = p('Key: 中文') as Record<string, unknown>
    expect(result.Key).toBe('中文')
  })

  it('handles value with backslash', () => {
    const result = p('Key: path\\to\\file') as Record<string, unknown>
    expect(result.Key).toBe('path\\to\\file')
  })

  it('handles key with hyphen', () => {
    const result = p('My-Key: Value') as Record<string, unknown>
    expect(result['My-Key']).toBe('Value')
  })

  it('handles key with underscore', () => {
    const result = p('My_Key: Value') as Record<string, unknown>
    expect(result.My_Key).toBe('Value')
  })

  it('handles empty input', () => {
    const result = p('')
    expect(result).toEqual({})
  })

  it('handles whitespace-only input', () => {
    const result = p('   \n\t\n   ')
    expect(result).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// 13. Vite plugin
// ---------------------------------------------------------------------------

describe('Vite plugin', () => {
  it('creates plugin with correct name', () => {
    const plugin = miniYamlPlugin()
    expect(plugin.name).toBe('miniyaml-to-json')
  })

  it('transforms .yaml files', () => {
    const plugin = miniYamlPlugin()
    const code = 'Key: Value\nNested:\n\tChild: 123'
    const result = plugin.transform(code, 'test.yaml')

    expect(result).toBeDefined()
    expect(result!.code).toContain('export default JSON.parse')
    expect(result!.map).toBeNull()

    // Verify the JSON content is correct
    const match = result!.code.match(/JSON\.parse\((.*)\)/)
    expect(match).toBeTruthy()
    const parsed = JSON.parse(JSON.parse(match![1]))
    expect(parsed.Key).toBe('Value')
    expect(parsed.Nested).toEqual({ Child: '123' })
  })

  it('transforms .yml files', () => {
    const plugin = miniYamlPlugin()
    const result = plugin.transform('Key: Value', 'test.yml')
    expect(result).toBeDefined()
    expect(result!.code).toContain('export default')
  })

  it('transforms .miniyaml files', () => {
    const plugin = miniYamlPlugin()
    const result = plugin.transform('Key: Value', 'test.miniyaml')
    expect(result).toBeDefined()
    expect(result!.code).toContain('export default')
  })

  it('ignores non-yaml files', () => {
    const plugin = miniYamlPlugin()
    const result = plugin.transform('const x = 1', 'test.ts')
    expect(result).toBeUndefined()
  })

  it('ignores .json files', () => {
    const plugin = miniYamlPlugin()
    const result = plugin.transform('{}', 'test.json')
    expect(result).toBeUndefined()
  })

  it('handles empty yaml file', () => {
    const plugin = miniYamlPlugin()
    const result = plugin.transform('', 'empty.yaml')
    expect(result).toBeDefined()
    const match = result!.code.match(/JSON\.parse\((.*)\)/)
    expect(match).toBeTruthy()
    const parsed = JSON.parse(JSON.parse(match![1]))
    expect(parsed).toEqual({})
  })

  it('handles yaml with only comments', () => {
    const plugin = miniYamlPlugin()
    const result = plugin.transform('# comment 1\n# comment 2', 'comments.yaml')
    expect(result).toBeDefined()
    const match = result!.code.match(/JSON\.parse\((".*")\);?$/)
    expect(match).toBeTruthy()
    const parsed = JSON.parse(JSON.parse(match![1]))
    expect(parsed).toEqual({})
  })

  it('throws on invalid yaml in transform', () => {
    const plugin = miniYamlPlugin()
    // Bad indentation should throw
    const code = 'Root:\n\t\tChild: Value'
    expect(() => plugin.transform(code, 'bad.yaml')).toThrow()
  })
})

// ---------------------------------------------------------------------------
// 14. isMiniYamlFile utility
// ---------------------------------------------------------------------------

describe('isMiniYamlFile', () => {
  it('returns true for .yaml', () => {
    expect(isMiniYamlFile('test.yaml')).toBe(true)
  })

  it('returns true for .yml', () => {
    expect(isMiniYamlFile('test.yml')).toBe(true)
  })

  it('returns true for .miniyaml', () => {
    expect(isMiniYamlFile('test.miniyaml')).toBe(true)
  })

  it('returns true for uppercase extensions', () => {
    expect(isMiniYamlFile('test.YAML')).toBe(true)
    expect(isMiniYamlFile('test.YML')).toBe(true)
  })

  it('returns false for .json', () => {
    expect(isMiniYamlFile('test.json')).toBe(false)
  })

  it('returns false for .ts', () => {
    expect(isMiniYamlFile('test.ts')).toBe(false)
  })

  it('returns false for no extension', () => {
    expect(isMiniYamlFile('test')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 15. MiniYamlParser.parseToString
// ---------------------------------------------------------------------------

describe('parseToString', () => {
  it('returns formatted JSON string', () => {
    const parser = new MiniYamlParser()
    const json = parser.parseToString('Key: Value')
    expect(json).toContain('"Key": "Value"')
    expect(json).toContain('\n')
  })

  it('returns parseable JSON', () => {
    const parser = new MiniYamlParser()
    const json = parser.parseToString('A: 1\nB: 2')
    const parsed = JSON.parse(json)
    expect(parsed.A).toBe('1')
    expect(parsed.B).toBe('2')
  })
})

// ---------------------------------------------------------------------------
// 16. Edge cases and boundary values
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('handles very deep nesting', () => {
    const input = 'L0:\n\tL1:\n\t\tL2:\n\t\t\tL3:\n\t\t\t\tL4:\n\t\t\t\t\tL5: deep'
    const result = p(input) as Record<string, unknown>
    expect(result.L0).toEqual({
      L1: { L2: { L3: { L4: { L5: 'deep' } } } },
    })
  })

  it('handles many siblings', () => {
    const input = Array.from({ length: 50 }, (_, i) => `Key${i}: Value${i}`).join('\n')
    const result = p(input) as Record<string, unknown>
    for (let i = 0; i < 50; i++) {
      expect(result[`Key${i}`]).toBe(`Value${i}`)
    }
  })

  it('handles CRLF line endings', () => {
    const input = 'Key1: Value1\r\nKey2: Value2'
    const result = p(input) as Record<string, unknown>
    expect(result.Key1).toBe('Value1')
    expect(result.Key2).toBe('Value2')
  })

  it('handles mixed line endings', () => {
    const input = 'Key1: Value1\r\nKey2: Value2\nKey3: Value3'
    const result = p(input) as Record<string, unknown>
    expect(result.Key1).toBe('Value1')
    expect(result.Key2).toBe('Value2')
    expect(result.Key3).toBe('Value3')
  })

  it('handles value that looks like a number', () => {
    const result = p('Version: 1.0') as Record<string, unknown>
    expect(result.Version).toBe('1.0')
  })

  it('handles value with trailing spaces', () => {
    const result = p('Key: value   ') as Record<string, unknown>
    expect(result.Key).toBe('value')
  })

  it('handles key with leading spaces', () => {
    const result = p('   Key: Value') as Record<string, unknown>
    expect(result.Key).toBe('Value')
  })

  it('handles single character key and value', () => {
    const result = p('A: B') as Record<string, unknown>
    expect(result.A).toBe('B')
  })

  it('handles value with only spaces (becomes null)', () => {
    const result = p('Key:    ') as Record<string, unknown>
    expect(result.Key).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 17. OpenRA parity tests (from MiniYamlTest.cs)
// ---------------------------------------------------------------------------

describe('OpenRA parity', () => {
  it('handles empty lines between content', () => {
    const input = 'Key1: Value1\n\n\nKey2: Value2'
    const result = p(input) as Record<string, unknown>
    expect(result.Key1).toBe('Value1')
    expect(result.Key2).toBe('Value2')
  })

  it('handles comment between nodes', () => {
    const input = 'Key1: Value1\n# Comment\nKey2: Value2'
    const result = p(input) as Record<string, unknown>
    expect(result.Key1).toBe('Value1')
    expect(result.Key2).toBe('Value2')
  })

  it('parses real OpenRA actor format', () => {
    const input = `^Building:
\tInherits@1: ^ExistsInWorld
\tInherits@2: ^SpriteActor
\tTooltip:
\t\tName: Building
\t\tGenericName: Structure
\tBuilding:
\t\tDimensions: 1,1
\t\tFootprint: x
\tHealth:
\t\tHP: 100000
\tArmor:
\t\tType: Wood
\tRevealsShroud:
\t\tRange: 4c0
\t\tType: CenterPosition`

    const result = p(input) as Record<string, unknown>
    expect(result['^Building']).toBeDefined()
    const building = result['^Building'] as Record<string, unknown>

    expect(building.Inherits).toBeDefined()
    const inherits = building.Inherits as Array<Record<string, unknown>>
    expect(Array.isArray(inherits)).toBe(true)
    expect(inherits.length).toBe(2)
    expect(inherits[0]).toEqual({ id: '1', value: '^ExistsInWorld' })
    expect(inherits[1]).toEqual({ id: '2', value: '^SpriteActor' })

    expect(building.Tooltip).toEqual({
      Name: 'Building',
      GenericName: 'Structure',
    })
    expect(building.Building).toEqual({
      Dimensions: '1,1',
      Footprint: 'x',
    })
    expect(building.Health).toEqual({ HP: '100000' })
    expect(building.Armor).toEqual({ Type: 'Wood' })
    expect(building.RevealsShroud).toEqual({
      Range: '4c0',
      Type: 'CenterPosition',
    })
  })

  it('handles ^-prefixed template keys', () => {
    const input = '^Base:\n\tKey: value'
    const result = p(input) as Record<string, unknown>
    expect(result['^Base']).toEqual({ Key: 'value' })
  })

  it('handles nested removal in inheritance', () => {
    const input = `^Base:
\tSection:
\t\tA: 1
\t\tB: 2
Child:
\tInherits: ^Base
\tSection:
\t\t-B:
\t\tC: 3`

    const result = p(input) as Record<string, unknown>
    expect(result.Child).toEqual({
      Section: { A: '1', C: '3' },
    })
  })
})

// ---------------------------------------------------------------------------
// 18. Whitespace guard tests (OpenRA feature)
// ---------------------------------------------------------------------------

describe('whitespace guards', () => {
  it('preserves leading whitespace with backslash guard', () => {
    // Input: "Key: \\   test" -> after parsing: backslash guards leading spaces
    // The value portion is "\\   test" -> trim -> "\\   test" -> guard removes \ -> "   test" (3 spaces)
    const result = p('Key: \\   test') as Record<string, unknown>
    expect(result.Key).toBe('   test')
  })

  it('preserves trailing whitespace with backslash guard', () => {
    const result = p('Key: test   \\') as Record<string, unknown>
    expect(result.Key).toBe('test   ')
  })
})

// ---------------------------------------------------------------------------
// 19. Parser options
// ---------------------------------------------------------------------------

describe('parser options', () => {
  it('defaults resolveInherits to true', () => {
    const parser = new MiniYamlParser()
    expect(parser.resolveInherits).toBe(true)
  })

  it('can disable inheritance resolution', () => {
    const parser = new MiniYamlParser({ resolveInherits: false })
    expect(parser.resolveInherits).toBe(false)
  })

  it('preserves Inherits nodes when disabled', () => {
    const input = 'Child:\n\tInherits: ^Base\n\tKey: value'
    const parser = new MiniYamlParser({ resolveInherits: false })
    const result = parser.parse(input) as Record<string, unknown>
    expect(result.Child).toEqual({
      Inherits: '^Base',
      Key: 'value',
    })
  })
})

// ---------------------------------------------------------------------------
// 20. Error message quality
// ---------------------------------------------------------------------------

describe('error messages', () => {
  it('includes line number in parse error', () => {
    try {
      p('Root:\n\n\t\tBad: Value')
      expect.fail('Should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(MiniYamlParseError)
      const err = e as MiniYamlParseError
      expect(err.message).toContain('Line 3')
      expect(err.line).toBe(3)
    }
  })

  it('error name is MiniYamlParseError', () => {
    try {
      p('Root:\n\t\tBad: Value')
      expect.fail('Should have thrown')
    } catch (e) {
      expect((e as Error).name).toBe('MiniYamlParseError')
    }
  })
})
