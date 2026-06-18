/**
 * DocumentationHelpers.test.ts — DocumentationHelpers unit tests
 *
 * Tests for: getAllTraitInfos, getTraitFields, getEnumValues,
 * getSourceFilenameForType, formatTraitDoc, formatClassInfo.
 *
 * Pure logic tests — no Babylon.js, no WebGL.
 */

import { describe, it, expect } from 'vitest'
import {
  getAllTraitInfos,
  getTraitFields,
  getEnumValues,
  getSourceFilenameForType,
  formatTraitDoc,
  formatClassInfo,
  type TraitDescriptor,
  type EnumDescriptor,
} from './DocumentationHelpers.js'
import type {
  ExtractedClassInfo,
  ExtractedTraitInfo,
} from './Objects.js'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeTraitDesc(overrides: Partial<TraitDescriptor> = {}): TraitDescriptor {
  return {
    namespace: 'Test.Traits',
    name: 'TestTraitInfo',
    filename: 'Test/Traits/TestTrait.ts',
    description: 'A test trait for unit testing.',
    inheritedTypes: ['TraitInfo'],
    requiresTraits: [],
    fields: [
      {
        propertyName: 'Speed',
        type: 'integer',
        defaultValue: '42',
        description: 'Movement speed in cells/tick.',
      },
      {
        propertyName: 'Name',
        type: 'string',
        defaultValue: '"default"',
        description: 'Display name.',
      },
    ],
    ...overrides,
  }
}

function makeEnumDesc(name: string, values: Record<number, string>): EnumDescriptor {
  return {
    namespace: 'Test',
    name,
    filename: `Test/${name}.ts`,
    values,
  }
}

// ---------------------------------------------------------------------------
// getAllTraitInfos
// ---------------------------------------------------------------------------

describe('getAllTraitInfos', () => {
  it('should return empty array for empty registry', () => {
    expect(getAllTraitInfos({})).toEqual([])
  })

  it('should convert trait descriptors to ExtractedTraitInfo', () => {
    const registry = {
      TestTraitInfo: makeTraitDesc({ name: 'TestTraitInfo' }),
      AnotherTraitInfo: makeTraitDesc({
        name: 'AnotherTraitInfo',
        description: 'Another trait.',
        fields: [
          {
            propertyName: 'Health',
            type: 'integer',
            defaultValue: '100',
            description: 'HP.',
          },
        ],
      }),
    }

    const result = getAllTraitInfos(registry)
    expect(result).toHaveLength(2)
    expect(result[0].Name).toBeDefined()
    expect(result[0].Properties.length).toBeGreaterThan(0)

    // Verify trait names
    const names = result.map((t) => t.Name).sort()
    expect(names).toEqual(['AnotherTraitInfo', 'TestTraitInfo'])
  })

  it('should include RequiresTraits in output', () => {
    const registry = {
      WithDeps: makeTraitDesc({
        name: 'WithDeps',
        requiresTraits: ['Base', 'Support'],
      }),
    }

    const result = getAllTraitInfos(registry)
    expect(result[0].RequiresTraits).toEqual(['Base', 'Support'])
  })

  it('should populate Properties with field data', () => {
    const registry = {
      Test: makeTraitDesc({
        fields: [
          {
            propertyName: 'Scale',
            type: 'float',
            defaultValue: '1.0',
            description: 'Scale factor.',
          },
        ],
      }),
    }

    const result = getAllTraitInfos(registry)
    const props = result[0].Properties
    expect(props).toHaveLength(1)
    expect(props[0].PropertyName).toBe('Scale')
    expect(props[0].DefaultValue).toBe('1.0')
    expect(props[0].InternalType).toBe('float')
    expect(props[0].UserFriendlyType).toBe('float')
    expect(props[0].Description).toBe('Scale factor.')
  })

  it('should handle fields with attributes', () => {
    const registry = {
      Test: makeTraitDesc({
        fields: [
          {
            propertyName: 'Weapon',
            type: 'string',
            defaultValue: 'null',
            description: 'Weapon name.',
            attributes: [
              {
                name: 'WeaponReference',
                parameters: { required: 'true' },
              },
            ],
          },
        ],
      }),
    }

    const result = getAllTraitInfos(registry)
    const props = result[0].Properties
    expect(props[0].OtherAttributes).toHaveLength(1)
    expect(props[0].OtherAttributes[0].Name).toBe('WeaponReference')
    expect(props[0].OtherAttributes[0].Parameters).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// getTraitFields
// ---------------------------------------------------------------------------

describe('getTraitFields', () => {
  it('should return field infos from trait descriptor', () => {
    const trait = makeTraitDesc()
    const fields = getTraitFields(trait)
    expect(fields).toHaveLength(2)
    expect(fields[0].PropertyName).toBe('Speed')
    expect(fields[1].PropertyName).toBe('Name')
  })

  it('should return empty array for trait with no fields', () => {
    const trait = makeTraitDesc({ fields: [] })
    expect(getTraitFields(trait)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getEnumValues
// ---------------------------------------------------------------------------

describe('getEnumValues', () => {
  const registry: Record<string, EnumDescriptor> = {
    DamageState: makeEnumDesc('DamageState', {
      0: 'Undamaged',
      1: 'Light',
      2: 'Heavy',
    }),
    TargetType: makeEnumDesc('TargetType', {
      0: 'Ground',
      1: 'Water',
      2: 'Air',
    }),
    UnusedEnum: makeEnumDesc('UnusedEnum', { 0: 'None' }),
  }

  it('should return empty array for empty set', () => {
    expect(getEnumValues(new Set(), registry)).toEqual([])
  })

  it('should return matching enums sorted by name', () => {
    const result = getEnumValues(new Set(['TargetType', 'DamageState']), registry)
    expect(result).toHaveLength(2)
    expect(result[0].Name).toBe('DamageState') // alphabetically first
    expect(result[1].Name).toBe('TargetType')
  })

  it('should filter out unknown enum names', () => {
    const result = getEnumValues(new Set(['DamageState', 'NonExistent']), registry)
    expect(result).toHaveLength(1)
    expect(result[0].Name).toBe('DamageState')
  })

  it('should preserve value mappings', () => {
    const result = getEnumValues(new Set(['DamageState']), registry)
    expect(result[0].Values[0]).toBe('Undamaged')
    expect(result[0].Values[2]).toBe('Heavy')
    expect(Object.keys(result[0].Values)).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// getSourceFilenameForType
// ---------------------------------------------------------------------------

describe('getSourceFilenameForType', () => {
  const filenameMap = {
    'Test.Traits.MobileInfo': 'Test/Traits/Mobile.ts',
    'Test.Traits.HealthInfo': 'Test/Traits/Health.ts',
  }

  it('should return filename for known type', () => {
    expect(getSourceFilenameForType('Test.Traits.MobileInfo', filenameMap)).toBe(
      'Test/Traits/Mobile.ts',
    )
  })

  it('should return "(unknown)" for unknown type', () => {
    expect(getSourceFilenameForType('Unknown.Type', filenameMap)).toBe('(unknown)')
  })

  it('should return "(unknown)" for empty map', () => {
    expect(getSourceFilenameForType('Anything', {})).toBe('(unknown)')
  })
})

// ---------------------------------------------------------------------------
// formatTraitDoc
// ---------------------------------------------------------------------------

describe('formatTraitDoc', () => {
  it('should format trait with basic info', () => {
    const trait: ExtractedTraitInfo = {
      Namespace: 'Test.Traits',
      Name: 'MobileInfo',
      Filename: 'Test/Mobile.ts',
      Description: 'Unit can move.',
      InheritedTypes: ['TraitInfo'],
      RequiresTraits: [],
      Properties: [],
    }

    const result = formatTraitDoc(trait, [])
    expect(result).toContain('# MobileInfo')
    expect(result).toContain('**Namespace:** Test.Traits')
    expect(result).toContain('**Source:** Test/Mobile')
    expect(result).toContain('Unit can move.')
  })

  it('should format trait with properties table', () => {
    const trait: ExtractedTraitInfo = {
      Namespace: 'Test',
      Name: 'HealthInfo',
      Filename: 'Test/Health.ts',
      Description: '',
      InheritedTypes: [],
      RequiresTraits: [],
      Properties: [
        {
          PropertyName: 'HP',
          DefaultValue: '100',
          InternalType: 'int',
          UserFriendlyType: 'integer',
          Description: 'Hit points.',
          OtherAttributes: [],
        },
      ],
    }

    const result = formatTraitDoc(trait, [])
    expect(result).toContain('## Properties')
    expect(result).toContain('| `HP` | integer | `100` | Hit points. |')
  })

  it('should format trait with inherited types', () => {
    const trait: ExtractedTraitInfo = {
      Namespace: 'Test',
      Name: 'AdvancedTraitInfo',
      Filename: 'Test/Advanced.ts',
      Description: '',
      InheritedTypes: ['TraitInfo', 'IHealth'],
      RequiresTraits: [],
      Properties: [],
    }

    const result = formatTraitDoc(trait, [])
    expect(result).toContain('## Inherited Types')
    expect(result).toContain('- `TraitInfo`')
    expect(result).toContain('- `IHealth`')
  })

  it('should format trait with required traits', () => {
    const trait: ExtractedTraitInfo = {
      Namespace: 'Test',
      Name: 'TurretedAttackInfo',
      Filename: 'Test/TurretedAttack.ts',
      Description: '',
      InheritedTypes: [],
      RequiresTraits: ['AttackBase', 'Turreted'],
      Properties: [],
    }

    const result = formatTraitDoc(trait, [])
    expect(result).toContain('## Required Traits')
    expect(result).toContain('- `AttackBase`')
    expect(result).toContain('- `Turreted`')
  })

  it('should format related enums', () => {
    const trait: ExtractedTraitInfo = {
      Namespace: 'Test',
      Name: 'TestInfo',
      Filename: 'Test.ts',
      Description: '',
      InheritedTypes: [],
      RequiresTraits: [],
      Properties: [],
    }

    const relatedEnums = [
      {
        Namespace: 'Test',
        Name: 'DamageState',
        Filename: 'Test/DamageState.ts',
        Values: { 0: 'Undamaged', 1: 'Light' },
      },
    ]

    const result = formatTraitDoc(trait, relatedEnums)
    expect(result).toContain('## Related Enums')
    expect(result).toContain('### DamageState')
    expect(result).toContain('| 0 | `Undamaged` |')
    expect(result).toContain('| 1 | `Light` |')
  })

  it('should handle properties with pipe characters in description', () => {
    const trait: ExtractedTraitInfo = {
      Namespace: 'Test',
      Name: 'TestInfo',
      Filename: 'Test.ts',
      Description: '',
      InheritedTypes: [],
      RequiresTraits: [],
      Properties: [
        {
          PropertyName: 'Type',
          DefaultValue: 'A|B',
          InternalType: 'string',
          UserFriendlyType: 'string',
          Description: 'Choose A | B | C.',
          OtherAttributes: [],
        },
      ],
    }

    const result = formatTraitDoc(trait, [])
    // Pipe in description should be escaped
    expect(result).toContain('Choose A \\| B \\| C.')
  })

  it('should return empty string for empty trait (no info)', () => {
    const trait: ExtractedTraitInfo = {
      Namespace: '',
      Name: '',
      Filename: '',
      Description: '',
      InheritedTypes: [],
      RequiresTraits: [],
      Properties: [],
    }

    const result = formatTraitDoc(trait, [])
    // Should at least contain the empty name heading
    expect(result).toContain('# ')
  })
})

// ---------------------------------------------------------------------------
// formatClassInfo
// ---------------------------------------------------------------------------

describe('formatClassInfo', () => {
  it('should format class with inherited types', () => {
    const classInfo: ExtractedClassInfo = {
      Namespace: 'Test',
      Name: 'MyClass',
      Filename: 'Test/MyClass.ts',
      Description: 'A test class.',
      InheritedTypes: ['BaseClass', 'IInterface'],
      Properties: [],
    }

    const result = formatClassInfo(classInfo)
    expect(result).toContain('# MyClass')
    expect(result).toContain('- `BaseClass`')
    expect(result).toContain('- `IInterface`')
    expect(result).toContain('A test class.')
  })

  it('should format class with properties table', () => {
    const classInfo: ExtractedClassInfo = {
      Namespace: 'Test',
      Name: 'Settings',
      Filename: 'Test/Settings.ts',
      Description: '',
      InheritedTypes: [],
      Properties: [
        {
          PropertyName: 'Volume',
          DefaultValue: '100',
          InternalType: 'int',
          UserFriendlyType: 'integer',
          Description: 'Volume percentage.',
          OtherAttributes: [],
        },
        {
          PropertyName: 'Muted',
          DefaultValue: 'False',
          InternalType: 'bool',
          UserFriendlyType: 'boolean',
          Description: 'Whether audio is muted.',
          OtherAttributes: [],
        },
      ],
    }

    const result = formatClassInfo(classInfo)
    expect(result).toContain('| `Volume` | integer | `100` | Volume percentage. |')
    expect(result).toContain('| `Muted` | boolean | `False` | Whether audio is muted. |')
  })
})
