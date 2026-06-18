/**
 * Objects.test.ts — Documentation Objects interfaces unit tests
 *
 * Tests that the data interfaces have the correct shape and can be
 * constructed/used correctly.
 */

import { describe, it, expect } from 'vitest'
import type {
  ExtractedClassFieldAttributeParameter,
  ExtractedClassFieldAttributeInfo,
  ExtractedClassFieldInfo,
  ExtractedClassInfo,
  ExtractedEnumInfo,
  ExtractedTraitInfo,
} from './Objects.js'

// ---------------------------------------------------------------------------
// ExtractedClassFieldAttributeParameter
// ---------------------------------------------------------------------------

describe('ExtractedClassFieldAttributeParameter', () => {
  it('should accept valid parameter data', () => {
    const param: ExtractedClassFieldAttributeParameter = {
      Name: 'min',
      Value: '0',
    }
    expect(param.Name).toBe('min')
    expect(param.Value).toBe('0')
  })

  it('should handle empty value', () => {
    const param: ExtractedClassFieldAttributeParameter = {
      Name: 'flag',
      Value: '',
    }
    expect(param.Name).toBe('flag')
    expect(param.Value).toBe('')
  })
})

// ---------------------------------------------------------------------------
// ExtractedClassFieldAttributeInfo
// ---------------------------------------------------------------------------

describe('ExtractedClassFieldAttributeInfo', () => {
  it('should accept attribute with parameters', () => {
    const attr: ExtractedClassFieldAttributeInfo = {
      Name: 'ActorReference',
      Parameters: [
        { Name: 'type', Value: 'e1' },
        { Name: 'count', Value: '5' },
      ],
    }
    expect(attr.Name).toBe('ActorReference')
    expect(attr.Parameters).toHaveLength(2)
    expect(attr.Parameters[0].Name).toBe('type')
    expect(attr.Parameters[1].Value).toBe('5')
  })

  it('should accept attribute with no parameters', () => {
    const attr: ExtractedClassFieldAttributeInfo = {
      Name: 'Required',
      Parameters: [],
    }
    expect(attr.Name).toBe('Required')
    expect(attr.Parameters).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// ExtractedClassFieldInfo
// ---------------------------------------------------------------------------

describe('ExtractedClassFieldInfo', () => {
  it('should accept complete field info', () => {
    const field: ExtractedClassFieldInfo = {
      PropertyName: 'Speed',
      DefaultValue: '56',
      InternalType: 'int',
      UserFriendlyType: 'integer',
      Description: 'Movement speed of the unit.',
      OtherAttributes: [],
    }
    expect(field.PropertyName).toBe('Speed')
    expect(field.DefaultValue).toBe('56')
    expect(field.Description).toBe('Movement speed of the unit.')
  })

  it('should accept field with other attributes', () => {
    const field: ExtractedClassFieldInfo = {
      PropertyName: 'Weapon',
      DefaultValue: 'null',
      InternalType: 'string',
      UserFriendlyType: 'string',
      Description: 'The weapon to use.',
      OtherAttributes: [
        {
          Name: 'WeaponReference',
          Parameters: [{ Name: 'required', Value: 'true' }],
        },
      ],
    }
    expect(field.OtherAttributes).toHaveLength(1)
    expect(field.OtherAttributes[0].Name).toBe('WeaponReference')
  })
})

// ---------------------------------------------------------------------------
// ExtractedClassInfo
// ---------------------------------------------------------------------------

describe('ExtractedClassInfo', () => {
  it('should accept class info with properties', () => {
    const classInfo: ExtractedClassInfo = {
      Namespace: 'OpenRA.Mods.Common.Traits',
      Name: 'MobileInfo',
      Filename: 'OpenRA.Mods.Common/Traits/Mobile.cs',
      Description: 'Unit is able to move.',
      InheritedTypes: ['TraitInfo', 'IHealth'],
      Properties: [
        {
          PropertyName: 'Speed',
          DefaultValue: '56',
          InternalType: 'int',
          UserFriendlyType: 'integer',
          Description: 'Movement speed.',
          OtherAttributes: [],
        },
      ],
    }
    expect(classInfo.Name).toBe('MobileInfo')
    expect(classInfo.InheritedTypes).toContain('TraitInfo')
    expect(classInfo.Properties).toHaveLength(1)
  })

  it('should handle empty properties and inherited types', () => {
    const classInfo: ExtractedClassInfo = {
      Namespace: 'OpenRA.Mods.Common.Traits',
      Name: 'EmptyTraitInfo',
      Filename: 'unknown',
      Description: '',
      InheritedTypes: [],
      Properties: [],
    }
    expect(classInfo.Properties).toHaveLength(0)
    expect(classInfo.InheritedTypes).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// ExtractedEnumInfo
// ---------------------------------------------------------------------------

describe('ExtractedEnumInfo', () => {
  it('should accept enum info with values', () => {
    const enumInfo: ExtractedEnumInfo = {
      Namespace: 'OpenRA.Traits',
      Name: 'DamageState',
      Filename: 'OpenRA.Game/Traits/DamageState.cs',
      Values: {
        0: 'Undamaged',
        1: 'Light',
        2: 'Medium',
        3: 'Heavy',
        4: 'Critical',
        5: 'Dead',
      },
    }
    expect(enumInfo.Name).toBe('DamageState')
    expect(Object.keys(enumInfo.Values)).toHaveLength(6)
    expect(enumInfo.Values[0]).toBe('Undamaged')
    expect(enumInfo.Values[5]).toBe('Dead')
  })

  it('should handle empty values', () => {
    const enumInfo: ExtractedEnumInfo = {
      Namespace: 'Test',
      Name: 'EmptyEnum',
      Filename: 'test.ts',
      Values: {},
    }
    expect(Object.keys(enumInfo.Values)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// ExtractedTraitInfo
// ---------------------------------------------------------------------------

describe('ExtractedTraitInfo', () => {
  it('should extend ExtractedClassInfo with RequiresTraits', () => {
    const traitInfo: ExtractedTraitInfo = {
      Namespace: 'OpenRA.Mods.Common.Traits',
      Name: 'AttackTurretedInfo',
      Filename: 'OpenRA.Mods.Common/Traits/AttackTurreted.cs',
      Description: 'Actor has a turret that can rotate.',
      InheritedTypes: ['TraitInfo', 'AttackBaseInfo'],
      RequiresTraits: ['Turreted', 'AttackBase'],
      Properties: [],
    }
    expect(traitInfo.Name).toBe('AttackTurretedInfo')
    expect(traitInfo.RequiresTraits).toContain('Turreted')
    expect(traitInfo.RequiresTraits).toHaveLength(2)
  })

  it('should support empty required traits', () => {
    const traitInfo: ExtractedTraitInfo = {
      Namespace: 'Test',
      Name: 'SimpleTraitInfo',
      Filename: 'test.ts',
      Description: '',
      InheritedTypes: [],
      RequiresTraits: [],
      Properties: [],
    }
    expect(traitInfo.RequiresTraits).toHaveLength(0)
  })
})
