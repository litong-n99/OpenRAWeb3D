/**
 * ActorInfo.test.ts — ActorConfig migration unit tests
 *
 * Since ActorConfig is pure TypeScript data (no WebGL/Babylon.js deps),
 * all tests run without mocks. Tests focus on:
 * - JSON validation and error handling
 * - Trait composition and inheritance merging
 * - `-TraitName` removal semantics
 * - Topological sort with Kahn's algorithm
 * - Dependency resolution (hard + soft)
 * - Circular dependency detection
 * - Query methods (hasTraitInfo, traitInfo, traitInfos, etc.)
 * - Object.freeze() immutability
 * - Abstract actor prefix detection
 */

import { describe, it, expect } from 'vitest'
import {
  ActorConfig,
  ABSTRACT_ACTOR_PREFIX,
  TRAIT_INSTANCE_SEPARATOR,
  REMOVE_TRAIT_PREFIX,
  type TraitConfig,
  type ActorJSON,
} from './ActorInfo'

// =========================================================================
// Helpers
// =========================================================================

/** Create a minimal valid ActorJSON. */
function makeJSON(overrides?: Partial<ActorJSON>): ActorJSON {
  return {
    name: 'E1',
    traits: [],
    ...overrides,
  }
}

/** Create a minimal TraitJSON. */
function makeTrait(overrides?: Partial<import('./ActorInfo').TraitJSON>): import('./ActorInfo').TraitJSON {
  return {
    trait: 'TestTrait',
    implements: [],
    dependsOn: [],
    notBefore: [],
    properties: {},
    ...overrides,
  }
}

// =========================================================================
// fromJSON — basic validation
// =========================================================================

describe('ActorConfig.fromJSON validation', () => {
  it('parses a valid minimal config', () => {
    const config = ActorConfig.fromJSON(makeJSON())
    expect(config.name).toBe('E1')
    expect(config.isAbstract).toBe(false)
    expect(config.traitConfigs).toHaveLength(0)
    expect(config.inheritsFrom).toHaveLength(0)
  })

  it('throws when json is null', () => {
    expect(() => ActorConfig.fromJSON(null)).toThrow('expected object')
  })

  it('throws when json is not an object', () => {
    expect(() => ActorConfig.fromJSON('string')).toThrow('expected object')
    expect(() => ActorConfig.fromJSON(42)).toThrow('expected object')
    expect(() => ActorConfig.fromJSON(true)).toThrow('expected object')
  })

  it('throws when name is missing', () => {
    expect(() => ActorConfig.fromJSON({})).toThrow('name')
  })

  it('throws when name is empty', () => {
    expect(() => ActorConfig.fromJSON({ name: '' })).toThrow('name')
  })

  it('throws when traits is not an array', () => {
    expect(() =>
      ActorConfig.fromJSON({ name: 'E1', traits: 'not-an-array' }),
    ).toThrow('traits')
  })

  it('throws when inherits is not an array', () => {
    expect(() =>
      ActorConfig.fromJSON({ name: 'E1', inherits: 'string' }),
    ).toThrow('inherits')
  })

  it('throws when inherits contains non-strings', () => {
    expect(() =>
      ActorConfig.fromJSON({ name: 'E1', inherits: [42] }),
    ).toThrow('inherits')
  })

  it('accepts an empty traits array', () => {
    const config = ActorConfig.fromJSON(makeJSON({ traits: [] }))
    expect(config.traitConfigs).toHaveLength(0)
  })

  it('accepts config without traits field', () => {
    const config = ActorConfig.fromJSON({ name: 'TestActor' })
    expect(config.traitConfigs).toHaveLength(0)
  })
})

// =========================================================================
// Abstract actor prefix
// =========================================================================

describe('Abstract actor prefix', () => {
  it('detects abstract actors by ^ prefix', () => {
    const config = ActorConfig.fromJSON(makeJSON({ name: '^Infantry' }))
    expect(config.isAbstract).toBe(true)
    expect(config.name).toBe('^Infantry')
  })

  it('non-prefixed actors are not abstract', () => {
    const config = ActorConfig.fromJSON(makeJSON({ name: 'E1' }))
    expect(config.isAbstract).toBe(false)
  })

  it('ABSTRACT_ACTOR_PREFIX constant is ^', () => {
    expect(ABSTRACT_ACTOR_PREFIX).toBe('^')
    expect(ActorConfig.ABSTRACT_ACTOR_PREFIX).toBe('^')
  })
})

// =========================================================================
// Trait instance separator (@)
// =========================================================================

describe('Trait instance separator (@)', () => {
  it('parses @instance suffix', () => {
    const config = ActorConfig.fromJSON(
      makeJSON({
        traits: [makeTrait({ trait: 'Turreted@primary' })],
      }),
    )
    const t = config.traitConfigs[0]
    expect(t.name).toBe('Turreted')
    expect(t.instanceName).toBe('primary')
  })

  it('handles trait without instance suffix', () => {
    const config = ActorConfig.fromJSON(
      makeJSON({
        traits: [makeTrait({ trait: 'Health' })],
      }),
    )
    const t = config.traitConfigs[0]
    expect(t.name).toBe('Health')
    expect(t.instanceName).toBeUndefined()
  })

  it('throws on empty instance name after @', () => {
    expect(() =>
      ActorConfig.fromJSON(
        makeJSON({
          traits: [makeTrait({ trait: 'Turreted@' })],
        }),
      ),
    ).toThrow('empty instance name')
  })

  it('TRAIT_INSTANCE_SEPARATOR constant is @', () => {
    expect(TRAIT_INSTANCE_SEPARATOR).toBe('@')
    expect(ActorConfig.TRAIT_INSTANCE_SEPARATOR).toBe('@')
  })
})

// =========================================================================
// -TraitName removal
// =========================================================================

describe('-TraitName removal', () => {
  it('removes inherited trait via -prefix', () => {
    const parent = makeJSON({
      name: '^Base',
      traits: [
        makeTrait({ trait: 'Health' }),
        makeTrait({ trait: 'Mobile' }),
        makeTrait({ trait: 'RenderSprites' }),
      ],
    })
    const child = makeJSON({
      name: 'E1',
      inherits: ['^Base'],
      traits: [
        makeTrait({ trait: '-Mobile' }),
      ],
    })
    const config = ActorConfig.fromJSON(child, new Map([['^Base', parent]]))

    expect(config.hasTraitInfo('Health')).toBe(true)
    expect(config.hasTraitInfo('RenderSprites')).toBe(true)
    expect(config.hasTraitInfo('Mobile')).toBe(false)
    expect(config.traitConfigs).toHaveLength(2)
  })

  it('removing non-existent trait is not an error', () => {
    const parent = makeJSON({
      name: '^Base',
      traits: [makeTrait({ trait: 'Health' })],
    })
    const child = makeJSON({
      name: 'E1',
      inherits: ['^Base'],
      traits: [makeTrait({ trait: '-NonExistent' })],
    })

    // Should not throw
    const config = ActorConfig.fromJSON(child, new Map([['^Base', parent]]))
    expect(config.hasTraitInfo('Health')).toBe(true)
  })

  it('REMOVE_TRAIT_PREFIX constant is -', () => {
    expect(REMOVE_TRAIT_PREFIX).toBe('-')
    expect(ActorConfig.REMOVE_TRAIT_PREFIX).toBe('-')
  })
})

// =========================================================================
// Inheritance merging
// =========================================================================

describe('Inheritance merging', () => {
  it('child inherits parent traits', () => {
    const parent = makeJSON({
      name: '^Base',
      traits: [
        makeTrait({ trait: 'Health', properties: { maxHP: 100 } }),
        makeTrait({ trait: 'Mobile', properties: { speed: 56 } }),
      ],
    })
    const child = makeJSON({
      name: 'E1',
      inherits: ['^Base'],
      traits: [
        makeTrait({ trait: 'Armament', properties: { weapon: 'M60' } }),
      ],
    })
    const config = ActorConfig.fromJSON(child, new Map([['^Base', parent]]))

    expect(config.traitConfigs).toHaveLength(3)
    expect(config.hasTraitInfo('Health')).toBe(true)
    expect(config.hasTraitInfo('Mobile')).toBe(true)
    expect(config.hasTraitInfo('Armament')).toBe(true)
    expect(config.inheritsFrom).toContain('^Base')
  })

  it('child overrides parent trait properties', () => {
    const parent = makeJSON({
      name: '^Base',
      traits: [
        makeTrait({ trait: 'Health', properties: { maxHP: 100 } }),
      ],
    })
    const child = makeJSON({
      name: 'E1',
      inherits: ['^Base'],
      traits: [
        makeTrait({ trait: 'Health', properties: { maxHP: 125 } }),
      ],
    })
    const config = ActorConfig.fromJSON(child, new Map([['^Base', parent]]))

    const health = config.traitInfo('Health')
    expect(health.properties.maxHP).toBe(125)
    expect(config.traitConfigs).toHaveLength(1) // overridden, not duplicated
  })

  it('throws when parent not found in allConfigs', () => {
    const child = makeJSON({
      name: 'E1',
      inherits: ['^MissingParent'],
      traits: [],
    })

    expect(() =>
      ActorConfig.fromJSON(child, new Map()),
    ).toThrow('parent "^MissingParent" not found')
  })

  it('throws when inherits specified but no allConfigs', () => {
    const child = makeJSON({
      name: 'E1',
      inherits: ['^Parent'],
      traits: [],
    })

    expect(() => ActorConfig.fromJSON(child)).toThrow(
      'no allConfigs provided',
    )
  })

  it('chains multiple levels of inheritance', () => {
    const grandparent = makeJSON({
      name: '^GrandParent',
      traits: [makeTrait({ trait: 'A', properties: { v: 1 } })],
    })
    const parent = makeJSON({
      name: '^Parent',
      inherits: ['^GrandParent'],
      traits: [makeTrait({ trait: 'B', properties: { v: 2 } })],
    })
    const child = makeJSON({
      name: 'Child',
      inherits: ['^Parent'],
      traits: [makeTrait({ trait: 'C', properties: { v: 3 } })],
    })

    const allConfigs = new Map<string, ActorJSON>([
      ['^GrandParent', grandparent],
      ['^Parent', parent],
      ['Child', child],
    ])
    const config = ActorConfig.fromJSON(child, allConfigs)

    expect(config.hasTraitInfo('A')).toBe(true)
    expect(config.hasTraitInfo('B')).toBe(true)
    expect(config.hasTraitInfo('C')).toBe(true)
    expect(config.traitConfigs).toHaveLength(3)
    // inheritsFrom should trace back through all ancestors
    expect(config.inheritsFrom).toContain('^GrandParent')
    expect(config.inheritsFrom).toContain('^Parent')
  })

  it('detects circular inheritance: A→B→A', () => {
    const a = makeJSON({ name: 'A', inherits: ['B'], traits: [] })
    const b = makeJSON({ name: 'B', inherits: ['A'], traits: [] })
    const allConfigs = new Map<string, ActorJSON>([['A', a], ['B', b]])

    expect(() => ActorConfig.fromJSON(a, allConfigs)).toThrow(
      'circular inheritance',
    )
  })

  it('detects circular inheritance: A→B→C→A', () => {
    const a = makeJSON({ name: 'A', inherits: ['B'], traits: [] })
    const b = makeJSON({ name: 'B', inherits: ['C'], traits: [] })
    const c = makeJSON({ name: 'C', inherits: ['A'], traits: [] })
    const allConfigs = new Map<string, ActorJSON>([['A', a], ['B', b], ['C', c]])

    expect(() => ActorConfig.fromJSON(a, allConfigs)).toThrow(
      'circular inheritance',
    )
  })

  it('circular inheritance error message names the chain', () => {
    const a = makeJSON({ name: 'A', inherits: ['B'], traits: [] })
    const b = makeJSON({ name: 'B', inherits: ['A'], traits: [] })
    const allConfigs = new Map<string, ActorJSON>([['A', a], ['B', b]])

    expect(() => ActorConfig.fromJSON(a, allConfigs)).toThrow(/A.*->.*B.*->.*A/)
  })

  it('child removal of trait at grandparent level', () => {
    const grandparent = makeJSON({
      name: '^GP',
      traits: [
        makeTrait({ trait: 'A' }),
        makeTrait({ trait: 'B' }),
        makeTrait({ trait: 'C' }),
      ],
    })
    const parent = makeJSON({
      name: '^P',
      inherits: ['^GP'],
      traits: [makeTrait({ trait: '-B' })],
    })
    const child = makeJSON({
      name: 'Final',
      inherits: ['^P'],
      traits: [makeTrait({ trait: '-C' })],
    })

    const allConfigs = new Map<string, ActorJSON>([
      ['^GP', grandparent],
      ['^P', parent],
      ['Final', child],
    ])
    const config = ActorConfig.fromJSON(child, allConfigs)

    expect(config.hasTraitInfo('A')).toBe(true)
    expect(config.hasTraitInfo('B')).toBe(false)
    expect(config.hasTraitInfo('C')).toBe(false)
    expect(config.traitConfigs).toHaveLength(1)
  })
})

// =========================================================================
// TraitConfig defaults
// =========================================================================

describe('TraitConfig defaults', () => {
  it('provides empty arrays for missing implements/dependsOn/notBefore', () => {
    const config = ActorConfig.fromJSON(
      makeJSON({
        traits: [makeTrait({ trait: 'Simple' })],
      }),
    )
    const t = config.traitConfigs[0]
    expect(t.implements).toEqual([])
    expect(t.dependsOn).toEqual([])
    expect(t.notBefore).toEqual([])
    expect(t.properties).toEqual({})
  })
})

// =========================================================================
// Topological sort — basic
// =========================================================================

describe('Topological sort', () => {
  it('preserves all traits when no dependencies', () => {
    const config = ActorConfig.fromJSON(
      makeJSON({
        traits: [
          makeTrait({ trait: 'A' }),
          makeTrait({ trait: 'B' }),
          makeTrait({ trait: 'C' }),
        ],
      }),
    )
    expect(config.traitConfigs).toHaveLength(3)
    const names = config.traitConfigs.map(t => t.name)
    expect(names).toContain('A')
    expect(names).toContain('B')
    expect(names).toContain('C')
  })

  it('sorts simple dependency chain: B dependsOn A → [A, B]', () => {
    const config = ActorConfig.fromJSON(
      makeJSON({
        traits: [
          makeTrait({
            trait: 'B',
            dependsOn: ['IAInterface'],
            implements: [],
          }),
          makeTrait({
            trait: 'A',
            dependsOn: [],
            implements: ['IAInterface'],
          }),
        ],
      }),
    )
    const names = config.traitConfigs.map(t => t.name)
    const idxA = names.indexOf('A')
    const idxB = names.indexOf('B')
    expect(idxA).toBeLessThan(idxB)
  })

  it('resolves transitive dependency: C→B→A', () => {
    const config = ActorConfig.fromJSON(
      makeJSON({
        traits: [
          makeTrait({
            trait: 'C',
            dependsOn: ['IBInterface'],
            implements: [],
          }),
          makeTrait({
            trait: 'B',
            dependsOn: ['IAInterface'],
            implements: ['IBInterface'],
          }),
          makeTrait({
            trait: 'A',
            dependsOn: [],
            implements: ['IAInterface'],
          }),
        ],
      }),
    )
    const names = config.traitConfigs.map(t => t.name)
    const idxA = names.indexOf('A')
    const idxB = names.indexOf('B')
    const idxC = names.indexOf('C')
    expect(idxA).toBeLessThan(idxB)
    expect(idxB).toBeLessThan(idxC)
  })

  it('throws when a hard dependency is missing', () => {
    expect(() =>
      ActorConfig.fromJSON(
        makeJSON({
          name: 'BadActor',
          traits: [
            makeTrait({
              trait: 'A',
              dependsOn: ['INonExistent'],
              implements: [],
            }),
          ],
        }),
      ),
    ).toThrow('Missing')
  })

  it('error message includes trait names for missing deps', () => {
    expect(() =>
      ActorConfig.fromJSON(
        makeJSON({
          name: 'BadActor',
          traits: [
            makeTrait({
              trait: 'Health',
              dependsOn: ['INotFound'],
            }),
          ],
        }),
      ),
    ).toThrow(/BadActor.*failed to initialize/i)
  })
})

// =========================================================================
// Topological sort — circular dependency
// =========================================================================

describe('Circular dependency detection', () => {
  it('detects A→B→A cycle', () => {
    expect(() =>
      ActorConfig.fromJSON(
        makeJSON({
          name: 'Cyclic',
          traits: [
            makeTrait({
              trait: 'A',
              dependsOn: ['IB'],
              implements: ['IA'],
            }),
            makeTrait({
              trait: 'B',
              dependsOn: ['IA'],
              implements: ['IB'],
            }),
          ],
        }),
      ),
    ).toThrow('failed to initialize')
  })

  it('detects A→B→C→A cycle', () => {
    expect(() =>
      ActorConfig.fromJSON(
        makeJSON({
          name: 'ThreeCycle',
          traits: [
            makeTrait({
              trait: 'A',
              dependsOn: ['IB'],
              implements: ['IA'],
            }),
            makeTrait({
              trait: 'B',
              dependsOn: ['IC'],
              implements: ['IB'],
            }),
            makeTrait({
              trait: 'C',
              dependsOn: ['IA'],
              implements: ['IC'],
            }),
          ],
        }),
      ),
    ).toThrow('failed to initialize')
  })
})

// =========================================================================
// Topological sort — notBefore (soft dependency)
// =========================================================================

describe('notBefore soft dependency', () => {
  it('notBefore creates ordering when target exists', () => {
    const config = ActorConfig.fromJSON(
      makeJSON({
        traits: [
          makeTrait({
            trait: 'B',
            notBefore: ['IAInterface'],
            implements: [],
          }),
          makeTrait({
            trait: 'A',
            notBefore: [],
            implements: ['IAInterface'],
          }),
        ],
      }),
    )
    const names = config.traitConfigs.map(t => t.name)
    const idxA = names.indexOf('A')
    const idxB = names.indexOf('B')
    expect(idxA).toBeLessThan(idxB)
  })

  it('notBefore is ignored when target does not exist', () => {
    // B notBefore INonExistent — should not prevent construction
    const config = ActorConfig.fromJSON(
      makeJSON({
        traits: [
          makeTrait({
            trait: 'A',
            implements: [],
          }),
          makeTrait({
            trait: 'B',
            notBefore: ['INonExistent'],
            implements: [],
          }),
        ],
      }),
    )
    expect(config.traitConfigs).toHaveLength(2)
  })
})

// =========================================================================
// Query methods
// =========================================================================

describe('Query methods', () => {
  function makeTestConfig() {
    return ActorConfig.fromJSON(
      makeJSON({
        name: 'TestUnit',
        traits: [
          makeTrait({
            trait: 'Health',
            implements: ['IHealthInfo', 'ITraitInfoInterface'],
            properties: { maxHP: 125 },
          }),
          makeTrait({
            trait: 'Mobile',
            implements: ['IMoveInfo', 'ITraitInfoInterface'],
            dependsOn: [],
            properties: { speed: 56 },
          }),
          makeTrait({
            trait: 'RenderSprites',
            implements: ['IRenderInfo', 'ITraitInfoInterface'],
            properties: { palette: 'player' },
          }),
        ],
      }),
    )
  }

  it('hasTraitInfo returns true for existing trait', () => {
    const config = makeTestConfig()
    expect(config.hasTraitInfo('Health')).toBe(true)
    expect(config.hasTraitInfo('Mobile')).toBe(true)
    expect(config.hasTraitInfo('RenderSprites')).toBe(true)
  })

  it('hasTraitInfo returns false for missing trait', () => {
    const config = makeTestConfig()
    expect(config.hasTraitInfo('NonExistent')).toBe(false)
  })

  it('traitInfo returns the correct config', () => {
    const config = makeTestConfig()
    const health = config.traitInfo('Health')
    expect(health.name).toBe('Health')
    expect(health.properties.maxHP).toBe(125)
  })

  it('traitInfo throws for missing trait', () => {
    const config = makeTestConfig()
    expect(() => config.traitInfo('Missing')).toThrow(
      "does not have trait 'Missing'",
    )
  })

  it('traitInfoOrDefault returns undefined for missing', () => {
    const config = makeTestConfig()
    expect(config.traitInfoOrDefault('Missing')).toBeUndefined()
  })

  it('traitInfoOrDefault returns config for existing', () => {
    const config = makeTestConfig()
    expect(config.traitInfoOrDefault('Health')?.name).toBe('Health')
  })

  it('traitInfos returns all traits implementing an interface', () => {
    const config = makeTestConfig()
    const allTraitInfos = config.traitInfos('ITraitInfoInterface')
    expect(allTraitInfos).toHaveLength(3)

    const healthInfos = config.traitInfos('IHealthInfo')
    expect(healthInfos).toHaveLength(1)
    expect(healthInfos[0].name).toBe('Health')
  })

  it('traitInfos returns empty array for no matches', () => {
    const config = makeTestConfig()
    expect(config.traitInfos('INonExistent')).toEqual([])
  })
})

// =========================================================================
// getAllTargetTypes
// =========================================================================

describe('getAllTargetTypes', () => {
  it('unions target types from all ITargetableInfo traits', () => {
    const config = ActorConfig.fromJSON(
      makeJSON({
        traits: [
          makeTrait({
            trait: 'TargetableA',
            implements: ['ITargetableInfo'],
            properties: { targetTypes: ['Ground', 'Water'] },
          }),
          makeTrait({
            trait: 'TargetableB',
            implements: ['ITargetableInfo'],
            properties: { targetTypes: ['Air', 'Ground'] },
          }),
        ],
      }),
    )
    const types = config.getAllTargetTypes()
    expect(types.has('Ground')).toBe(true)
    expect(types.has('Water')).toBe(true)
    expect(types.has('Air')).toBe(true)
    expect(types.size).toBe(3)
  })

  it('returns empty set when no ITargetableInfo traits', () => {
    const config = ActorConfig.fromJSON(
      makeJSON({
        traits: [
          makeTrait({ trait: 'Health', implements: ['IHealthInfo'] }),
        ],
      }),
    )
    expect(config.getAllTargetTypes().size).toBe(0)
  })
})

// =========================================================================
// traitsInConstructOrder
// =========================================================================

describe('traitsInConstructOrder', () => {
  it('returns traits in dependency order', () => {
    const config = ActorConfig.fromJSON(
      makeJSON({
        traits: [
          makeTrait({
            trait: 'B',
            dependsOn: ['IA'],
            implements: [],
          }),
          makeTrait({
            trait: 'A',
            dependsOn: [],
            implements: ['IA'],
          }),
        ],
      }),
    )
    const sorted = config.traitsInConstructOrder()
    expect(sorted.map(t => t.name)).toEqual(['A', 'B'])
  })

  it('returns same array reference (frozen)', () => {
    const config = ActorConfig.fromJSON(makeJSON({ traits: [] }))
    const a = config.traitsInConstructOrder()
    const b = config.traitsInConstructOrder()
    expect(a).toBe(b) // same frozen reference
  })
})

// =========================================================================
// Object.freeze() immutability
// =========================================================================

describe('Object.freeze() immutability', () => {
  it('config is deeply frozen', () => {
    const config = ActorConfig.fromJSON(
      makeJSON({
        traits: [
          makeTrait({
            trait: 'Health',
            properties: { maxHP: 100 },
          }),
        ],
      }),
    )

    // Trying to mutate should throw in strict mode (which vitest runs in)
    expect(() => {
      // NOTE: We use try/catch because strict-mode TypeError is the
      // expected behavior for frozen objects.
      ;(config as unknown as Record<string, unknown>).name = 'Hacked'
    }).toThrow()
  })

  it('traitConfigs array is frozen', () => {
    const config = ActorConfig.fromJSON(
      makeJSON({
        traits: [makeTrait({ trait: 'A' })],
      }),
    )

    expect(() => {
      ;(config.traitConfigs as TraitConfig[]).push(
        makeTrait({ trait: 'B' }) as unknown as TraitConfig,
      )
    }).toThrow()
  })

  it('trait properties are frozen', () => {
    const config = ActorConfig.fromJSON(
      makeJSON({
        traits: [
          makeTrait({
            trait: 'Health',
            properties: { maxHP: 100 },
          }),
        ],
      }),
    )

    expect(() => {
      const props = config.traitConfigs[0].properties as Record<string, unknown>
      props.maxHP = 999
    }).toThrow()
  })

  it('accepts an empty config', () => {
    const config = ActorConfig.fromJSON(makeJSON())
    expect(Object.isFrozen(config.traitConfigs)).toBe(true)
  })
})

// =========================================================================
// Programmatic constructor
// =========================================================================

describe('Programmatic constructor', () => {
  it('creates ActorConfig directly from TraitConfig[]', () => {
    const config = new ActorConfig('E1', [
      {
        name: 'Health',
        instanceName: undefined,
        properties: { maxHP: 125 },
        implements: ['IHealthInfo'],
        dependsOn: [],
        notBefore: [],
      },
      {
        name: 'Mobile',
        instanceName: undefined,
        properties: { speed: 56 },
        implements: ['IMoveInfo'],
        dependsOn: [],
        notBefore: [],
      },
    ])

    expect(config.name).toBe('E1')
    expect(config.traitConfigs).toHaveLength(2)
    expect(config.hasTraitInfo('Health')).toBe(true)
    expect(config.hasTraitInfo('Mobile')).toBe(true)
  })

  it('throws on duplicate trait names', () => {
    expect(
      () =>
        new ActorConfig('E1', [
          { name: 'A', properties: {}, implements: [], dependsOn: [], notBefore: [] },
          { name: 'A', properties: {}, implements: [], dependsOn: [], notBefore: [] },
        ]),
    ).toThrow("duplicate trait 'A'")
  })

  it('sorts traits by dependency in constructor', () => {
    const config = new ActorConfig('E1', [
      {
        name: 'B',
        properties: {},
        implements: [],
        dependsOn: ['IA'],
        notBefore: [],
      },
      {
        name: 'A',
        properties: {},
        implements: ['IA'],
        dependsOn: [],
        notBefore: [],
      },
    ])

    expect(config.traitConfigs[0].name).toBe('A')
    expect(config.traitConfigs[1].name).toBe('B')
  })

  it('accepts inheritsFrom array', () => {
    const config = new ActorConfig(
      'E1',
      [
        {
          name: 'A',
          properties: {},
          implements: [],
          dependsOn: [],
          notBefore: [],
        },
      ],
      ['^Base'],
    )

    expect(config.inheritsFrom).toContain('^Base')
    expect(config.inheritsFrom).toHaveLength(1)
  })
})

// =========================================================================
// ToString
// =========================================================================

describe('toString', () => {
  it('includes name and trait names', () => {
    const config = ActorConfig.fromJSON(
      makeJSON({
        traits: [
          makeTrait({ trait: 'Health' }),
          makeTrait({ trait: 'Mobile' }),
        ],
      }),
    )
    const str = config.toString()
    expect(str).toContain('ActorConfig')
    expect(str).toContain('E1')
    expect(str).toContain('Health')
    expect(str).toContain('Mobile')
  })

  it('marks abstract actors', () => {
    const config = ActorConfig.fromJSON(makeJSON({ name: '^Base' }))
    expect(config.toString()).toContain('[abstract]')
  })
})

// =========================================================================
// Edge cases
// =========================================================================

describe('Edge cases', () => {
  it('traits with all fields populated parse correctly', () => {
    const config = ActorConfig.fromJSON(
      makeJSON({
        traits: [
          makeTrait({
            trait: 'Complex@main',
            implements: ['IA', 'IB', 'IC'],
            dependsOn: ['ID'],
            notBefore: ['IE'],
            properties: { a: 1, b: 'two', c: true, d: [1, 2, 3] },
          }),
          makeTrait({
            trait: 'Simple',
            implements: ['ID', 'IE'],
            dependsOn: [],
            notBefore: [],
            properties: {},
          }),
        ],
      }),
    )

    const complex = config.traitInfo('Complex')
    expect(complex.instanceName).toBe('main')
    expect(complex.implements).toEqual(['IA', 'IB', 'IC'])
    expect(complex.dependsOn).toEqual(['ID'])
    expect(complex.notBefore).toEqual(['IE'])
    expect(complex.properties.c).toBe(true)

    // Simple must come before Complex because Complex dependsOn ID,
    // which Simple implements
    const names = config.traitsInConstructOrder().map(t => t.name)
    expect(names.indexOf('Simple')).toBeLessThan(names.indexOf('Complex'))
  })

  it('multiple traits implement the same interface', () => {
    const config = ActorConfig.fromJSON(
      makeJSON({
        traits: [
          makeTrait({
            trait: 'TargetableA',
            implements: ['ITargetableInfo'],
            properties: {},
          }),
          makeTrait({
            trait: 'TargetableB',
            implements: ['ITargetableInfo'],
            properties: {},
          }),
        ],
      }),
    )

    const targetables = config.traitInfos('ITargetableInfo')
    expect(targetables).toHaveLength(2)
  })

  it('trait with dep on interface implemented by multiple traits', () => {
    const config = ActorConfig.fromJSON(
      makeJSON({
        traits: [
          makeTrait({
            trait: 'Consumer',
            dependsOn: ['IProvider'],
            implements: [],
          }),
          makeTrait({
            trait: 'ProviderA',
            implements: ['IProvider'],
          }),
          makeTrait({
            trait: 'ProviderB',
            implements: ['IProvider'],
          }),
        ],
      }),
    )

    // Both providers must come before Consumer
    const names = config.traitsInConstructOrder().map(t => t.name)
    const consumerIdx = names.indexOf('Consumer')
    expect(names.indexOf('ProviderA')).toBeLessThan(consumerIdx)
    expect(names.indexOf('ProviderB')).toBeLessThan(consumerIdx)
  })
})
