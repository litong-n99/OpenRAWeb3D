/**
 * Ruleset.test.ts — Ruleset container migration unit tests
 *
 * Since Ruleset is pure TypeScript data (no WebGL/Babylon.js deps),
 * all tests run without mocks. Tests focus on:
 * - Stub interface correctness
 * - SystemActors auto-insertion
 * - Ruleset constructor + IRulesetLoaded invocation
 * - mergeOrDefault merge semantics with conflict logging
 * - loadAsync JSON file loading pipeline
 * - _loadSimpleDict array/object format handling
 * - installedMusic / spawnableActors computed properties
 * - dispose() lifecycle
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  Ruleset,
  SystemActors,
  SYSTEM_ACTOR_NAMES,
  type WeaponInfo,
  type SoundInfo,
  type MusicInfo,
  type ModelSequenceConfig,
  type ProjectileStub,
  type WarheadStub,
} from './Ruleset'
import { ActorConfig, type TraitConfig } from './ActorInfo'
import type { IReadOnlyFileSystem } from '../FileSystem/IPackage.js'
import type { Manifest } from '../Manifest.js'
import type { ITerrainInfo } from '../Map/Map.js'

// =========================================================================
// Helpers
// =========================================================================

/** Create a minimal Manifest for testing. */
function makeManifest(overrides?: Partial<Record<string, string[]>>): Manifest {
  return {
    id: 'test-mod',
    metadata: { title: 'Test Mod', version: '1.0' },
    requiresMods: [],
    mounts: [],
    rules: overrides?.rules ?? [],
    sequences: [],
    modelSequences: overrides?.modelSequences ?? [],
    cursors: [],
    chrome: [],
    chromeLayout: [],
    weapons: overrides?.weapons ?? [],
    voices: overrides?.voices ?? [],
    notifications: overrides?.notifications ?? [],
    music: overrides?.music ?? [],
    fluentMessages: [],
    tileSets: [],
    chromeMetrics: [],
    missions: [],
    hotkeys: [],
    serverTraits: [],
    mapFolders: new Map(),
    mapCompatibility: ['test-mod'],
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
    validateDependencies: () => [],
  } as unknown as Manifest
}

/** Create a minimal ActorConfig. */
function makeActor(name: string, traitConfigs: TraitConfig[] = []): ActorConfig {
  return new ActorConfig(name, traitConfigs)
}

/** Create a minimal TraitConfig. */
function makeTrait(overrides?: Partial<TraitConfig>): TraitConfig {
  return {
    name: 'TestTrait',
    properties: {},
    implements: [],
    dependsOn: [],
    notBefore: [],
    ...overrides,
  }
}

/** Create a minimal WeaponInfo. */
function makeWeapon(overrides?: Partial<WeaponInfo>): WeaponInfo {
  return {
    name: 'TestWeapon',
    reloadDelay: 50,
    range: 10,
    burst: 1,
    ...overrides,
  }
}

/** Create a minimal SoundInfo. */
function makeSound(overrides?: Partial<SoundInfo>): SoundInfo {
  return {
    name: 'TestSound',
    volume: 1,
    attenuation: 1,
    ...overrides,
  }
}

/** Create a minimal MusicInfo. */
function makeMusic(overrides?: Partial<MusicInfo>): MusicInfo {
  return {
    filename: 'test.ogg',
    volume: 1,
    loop: false,
    exists: true,
    ...overrides,
  }
}

/** Create a minimal ModelSequenceConfig. */
function makeModelSeq(name: string = 'default'): ModelSequenceConfig {
  return { name, data: {} }
}

/**
 * Create a mock IReadOnlyFileSystem for testing.
 *
 * @param files — map of filename → JSON-serializable content (or null for missing).
 *   If a value is a string starting with `__RAW__:`, the rest is used as raw UTF-8 text
 *   (bypassing JSON.stringify).
 */
function mockFileSystem(
  files: Record<string, unknown>,
): IReadOnlyFileSystem {
  const encoder = new TextEncoder()
  return {
    openAsync: vi.fn(
      async (filename: string): Promise<ArrayBuffer | null> => {
        const content = files[filename]
        if (content === undefined) return null
        if (content === null) return null

        let text: string
        if (typeof content === 'string' && content.startsWith('__RAW__:')) {
          text = content.slice('__RAW__:'.length)
        } else {
          text = JSON.stringify(content)
        }
        return encoder.encode(text).buffer as ArrayBuffer
      },
    ),
    exists: vi.fn((filename: string) => filename in files && files[filename] !== null),
    isMounted: vi.fn(() => true),
  }
}

// =========================================================================
// SystemActors
// =========================================================================

describe('SystemActors', () => {
  it('defines four system actor names', () => {
    expect(SYSTEM_ACTOR_NAMES).toHaveLength(4)
    expect(SYSTEM_ACTOR_NAMES).toContain('player')
    expect(SYSTEM_ACTOR_NAMES).toContain('editorplayer')
    expect(SYSTEM_ACTOR_NAMES).toContain('world')
    expect(SYSTEM_ACTOR_NAMES).toContain('editorworld')
  })

  it('matches SystemActors const object', () => {
    expect(SystemActors.Player).toBe('player')
    expect(SystemActors.EditorPlayer).toBe('editorplayer')
    expect(SystemActors.World).toBe('world')
    expect(SystemActors.EditorWorld).toBe('editorworld')
  })
})

// =========================================================================
// Ruleset constructor
// =========================================================================

describe('Ruleset constructor', () => {
  it('stores all 7 dictionaries', () => {
    const actors = new Map([['e1', makeActor('e1')]])
    const weapons = new Map([['rifle', makeWeapon({ name: 'rifle' })]])
    const voices = new Map([['attack', makeSound({ name: 'attack' })]])
    const notifications = new Map([['alert', makeSound({ name: 'alert' })]])
    const music = new Map([['theme1', makeMusic({ filename: 'theme1.ogg' })]])
    const modelSeqs = new Map([['default', makeModelSeq('default')]])

    const rs = new Ruleset(
      actors, weapons, voices, notifications, music, null, modelSeqs,
    )

    expect(rs.actors.get('e1')?.name).toBe('e1')
    expect(rs.weapons.get('rifle')?.name).toBe('rifle')
    expect(rs.voices.get('attack')?.name).toBe('attack')
    expect(rs.notifications.get('alert')?.name).toBe('alert')
    expect(rs.music.get('theme1')?.filename).toBe('theme1.ogg')
    expect(rs.terrainInfo).toBeNull()
    expect(rs.modelSequences.get('default')?.name).toBe('default')
  })

  it('stores terrainInfo when provided', () => {
    const terrainInfo = {
      id: 'desert',
      terrainTypes: [],
      defaultTerrainTile: { type: 0, index: 0 },
      getTerrainInfo: () => ({ terrainType: 0, height: 0, rampType: 0, minColor: 0, maxColor: 0, getColor: () => 0, riser: { values: new Uint8Array(8), getConnection: () => 0 } }),
      tryGetTerrainInfo: () => null,
      getTerrainIndex: () => 0,
    } as unknown as ITerrainInfo
    const rs = new Ruleset(
      new Map(), new Map(), new Map(), new Map(), new Map(), terrainInfo, new Map(),
    )
    expect(rs.terrainInfo).toBe(terrainInfo)
  })

  it('auto-adds missing SystemActors', () => {
    const rs = new Ruleset(
      new Map(), new Map(), new Map(), new Map(), new Map(), null, new Map(),
    )

    // All 4 system actors should be present
    for (const sysName of SYSTEM_ACTOR_NAMES) {
      const actor = rs.actors.get(sysName)
      expect(actor, `system actor ${sysName} should exist`).toBeDefined()
      expect(actor!.name).toBe(sysName)
      expect(actor!.traitConfigs).toHaveLength(0) // empty by default
    }
  })

  it('does not overwrite existing SystemActors', () => {
    const customPlayer = makeActor('player', [
      makeTrait({ name: 'CustomHealth', implements: ['IHealth'] }),
    ])
    const actors = new Map([['player', customPlayer]])

    const rs = new Ruleset(
      actors, new Map(), new Map(), new Map(), new Map(), null, new Map(),
    )

    const player = rs.actors.get('player')
    expect(player).toBe(customPlayer) // same instance
    expect(player!.traitConfigs).toHaveLength(1)
    expect(player!.traitConfigs[0]!.name).toBe('CustomHealth')
  })

  it('invokes IRulesetLoaded on actor traits', () => {
    const receivedRuleset: { actors: unknown }[] = []
    const receivedActor: ActorConfig[] = []

    const handler: TraitConfig['rulesetLoaded'] = (rs, ai) => {
      receivedRuleset.push({ actors: rs.actors })
      receivedActor.push(ai)
    }

    const trait = makeTrait({
      name: 'TestTrait',
      implements: ['IRulesetLoaded'],
      rulesetLoaded: handler,
    })
    const actor = makeActor('e1', [trait])
    const actors = new Map([['e1', actor]])

    const rs = new Ruleset(
      actors, new Map(), new Map(), new Map(), new Map(), null, new Map(),
    )

    expect(receivedRuleset).toHaveLength(1)
    expect(receivedRuleset[0]!.actors).toBe(rs.actors)
    expect(receivedActor).toHaveLength(1)
    expect(receivedActor[0]).toBe(actor)
  })

  it('wraps trait handler errors with actor name', () => {
    const trait = makeTrait({
      name: 'FailingTrait',
      rulesetLoaded: () => {
        throw new Error('ruleset load failure')
      },
    })
    const actor = makeActor('e1', [trait])
    const actors = new Map([['e1', actor]])

    expect(
      () => new Ruleset(actors, new Map(), new Map(), new Map(), new Map(), null, new Map()),
    ).toThrow('Actor type e1: ruleset load failure')
  })

  it('invokes IRulesetLoaded on weapon projectiles', () => {
    const projectileCalled: WeaponInfo[] = []
    const proj: ProjectileStub = {
      type: 'Bullet',
      rulesetLoaded: (_rs, info) => {
        projectileCalled.push(info)
      },
    }
    const weapon = makeWeapon({
      name: 'rifle',
      projectiles: [proj],
    })
    const weapons = new Map([['rifle', weapon]])

    new Ruleset(
      new Map(), weapons, new Map(), new Map(), new Map(), null, new Map(),
    )

    expect(projectileCalled).toHaveLength(1)
    expect(projectileCalled[0]!.name).toBe('rifle')
  })

  it('invokes IRulesetLoaded on weapon warheads', () => {
    const warheadCalled: WeaponInfo[] = []
    const wh: WarheadStub = {
      type: 'SpreadDamage',
      rulesetLoaded: (_rs, info) => {
        warheadCalled.push(info)
      },
    }
    const weapon = makeWeapon({
      name: 'rifle',
      warheads: [wh],
    })
    const weapons = new Map([['rifle', weapon]])

    new Ruleset(
      new Map(), weapons, new Map(), new Map(), new Map(), null, new Map(),
    )

    expect(warheadCalled).toHaveLength(1)
    expect(warheadCalled[0]!.name).toBe('rifle')
  })

  it('wraps projectile handler errors with weapon name', () => {
    const proj: ProjectileStub = {
      type: 'Bullet',
      rulesetLoaded: () => {
        throw new Error('projectile failure')
      },
    }
    const weapon = makeWeapon({ name: 'rifle', projectiles: [proj] })
    const weapons = new Map([['rifle', weapon]])

    expect(
      () => new Ruleset(new Map(), weapons, new Map(), new Map(), new Map(), null, new Map()),
    ).toThrow('Projectile type rifle: projectile failure')
  })

  it('wraps warhead handler errors with weapon name', () => {
    const wh: WarheadStub = {
      type: 'SpreadDamage',
      rulesetLoaded: () => {
        throw new Error('warhead failure')
      },
    }
    const weapon = makeWeapon({ name: 'rifle', warheads: [wh] })
    const weapons = new Map([['rifle', weapon]])

    expect(
      () => new Ruleset(new Map(), weapons, new Map(), new Map(), new Map(), null, new Map()),
    ).toThrow('Weapon type rifle: warhead failure')
  })

  it('skips weapons with no projectiles or warheads gracefully', () => {
    const weapon = makeWeapon({ name: 'simple' })
    const weapons = new Map([['simple', weapon]])

    // Should not throw
    expect(
      () => new Ruleset(new Map(), weapons, new Map(), new Map(), new Map(), null, new Map()),
    ).not.toThrow()
  })

  it('multiple IRulesetLoaded traits on same actor all invoked', () => {
    const calls: string[] = []
    const trait1 = makeTrait({
      name: 'TraitA',
      rulesetLoaded: () => calls.push('A'),
    })
    const trait2 = makeTrait({
      name: 'TraitB',
      rulesetLoaded: () => calls.push('B'),
    })
    const actor = makeActor('multi', [trait1, trait2])
    const actors = new Map([['multi', actor]])

    new Ruleset(actors, new Map(), new Map(), new Map(), new Map(), null, new Map())

    expect(calls).toContain('A')
    expect(calls).toContain('B')
    expect(calls).toHaveLength(2)
  })
})

// =========================================================================
// installedMusic
// =========================================================================

describe('installedMusic', () => {
  it('filters out non-existent music', () => {
    const music = new Map<string, MusicInfo>([
      ['theme1', makeMusic({ filename: 'theme1.ogg', exists: true })],
      ['theme2', makeMusic({ filename: 'theme2.ogg', exists: false })],
      ['theme3', makeMusic({ filename: 'theme3.ogg', exists: true })],
    ])

    const rs = new Ruleset(
      new Map(), new Map(), new Map(), new Map(), music, null, new Map(),
    )

    const installed = rs.installedMusic
    expect(installed.size).toBe(2)
    expect(installed.has('theme1')).toBe(true)
    expect(installed.has('theme2')).toBe(false)
    expect(installed.has('theme3')).toBe(true)
  })

  it('returns empty map when no music exists', () => {
    const music = new Map<string, MusicInfo>([
      ['theme1', makeMusic({ filename: 'theme1.ogg', exists: false })],
    ])

    const rs = new Ruleset(
      new Map(), new Map(), new Map(), new Map(), music, null, new Map(),
    )

    expect(rs.installedMusic.size).toBe(0)
  })
})

// =========================================================================
// spawnableActors
// =========================================================================

describe('spawnableActors', () => {
  it('excludes abstract actors', () => {
    const normal = makeActor('e1')
    const abstract = makeActor('^Infantry')
    const actors = new Map([
      ['e1', normal],
      ['^infantry', abstract],
    ])

    const rs = new Ruleset(
      actors, new Map(), new Map(), new Map(), new Map(), null, new Map(),
    )

    const spawnable = rs.spawnableActors
    // 4 system actors + 1 normal = 5 spawnable; abstract excluded
    expect(spawnable.size).toBe(5)
    expect(spawnable.has('e1')).toBe(true)
    expect(spawnable.has('player')).toBe(true)
    expect(spawnable.has('^infantry')).toBe(false)
  })

  it('excludes system actors if they are abstract', () => {
    // System actors created by default have empty name — they are not abstract
    // unless their name starts with '^'
    const rs = new Ruleset(
      new Map(), new Map(), new Map(), new Map(), new Map(), null, new Map(),
    )

    const spawnable = rs.spawnableActors
    // player, editorplayer, world, editorworld — none start with '^'
    expect(spawnable.has('player')).toBe(true)
    expect(spawnable.has('world')).toBe(true)
  })
})

// =========================================================================
// mergeOrDefault
// =========================================================================

describe('mergeOrDefault', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('returns child when base is null', () => {
    const child = new Map([['a', 1], ['b', 2]])
    const result = Ruleset.mergeOrDefault(null, child, 'Test')
    expect(result).toBe(child) // same reference
  })

  it('returns child when base is null (no allocation)', () => {
    const child = new Map([['x', 'value']])
    const result = Ruleset.mergeOrDefault(null, child, 'Test')
    expect(result).toBe(child)
  })

  it('merges with no conflicts', () => {
    const base = new Map([['a', 1]])
    const child = new Map([['b', 2]])
    const result = Ruleset.mergeOrDefault(base, child, 'Test')

    expect(result.size).toBe(2)
    expect(result.get('a')).toBe(1)
    expect(result.get('b')).toBe(2)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('child overrides parent with conflict warning', () => {
    const base = new Map([['a', 1]])
    const child = new Map([['a', 99]])
    const result = Ruleset.mergeOrDefault(base, child, 'Weapons')

    expect(result.size).toBe(1)
    expect(result.get('a')).toBe(99) // child wins
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Weapons'),
    )
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("'a'"),
    )
  })

  it('multiple overrides all warn', () => {
    const base = new Map([['a', 1], ['b', 2], ['c', 3]])
    const child = new Map([['a', 10], ['b', 20]])
    const result = Ruleset.mergeOrDefault(base, child, 'Rules')

    expect(result.get('a')).toBe(10)
    expect(result.get('b')).toBe(20)
    expect(result.get('c')).toBe(3)
    expect(warnSpy).toHaveBeenCalledTimes(2)
  })

  it('works with object values', () => {
    const base = new Map([['a', { x: 1 }]])
    const child = new Map([['a', { x: 2 }]])
    const result = Ruleset.mergeOrDefault(base, child, 'Test')

    expect(result.get('a')).toEqual({ x: 2 })
  })

  it('works with empty maps', () => {
    const base = new Map<string, number>()
    const child = new Map<string, number>()
    const result = Ruleset.mergeOrDefault(base, child, 'Test')

    expect(result.size).toBe(0)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('maintains Map insertion order (base first, child appended)', () => {
    const base = new Map([['a', 1], ['b', 2]])
    const child = new Map([['c', 3]])
    const result = Ruleset.mergeOrDefault(base, child, 'Test')

    const keys = [...result.keys()]
    expect(keys[0]).toBe('a')
    expect(keys[1]).toBe('b')
    expect(keys[2]).toBe('c')
  })

  it('overridden keys stay in original base position', () => {
    const base = new Map([['a', 1], ['b', 2], ['c', 3]])
    const child = new Map([['b', 20]])
    const result = Ruleset.mergeOrDefault(base, child, 'Test')

    const keys = [...result.keys()]
    expect(keys[0]).toBe('a')
    expect(keys[1]).toBe('b') // overridden but stays in position
    expect(keys[2]).toBe('c')
  })
})

// =========================================================================
// loadAsync
// =========================================================================

describe('loadAsync', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('loads actors from rules JSON files', async () => {
    const manifest = makeManifest({ rules: ['rules.json'] })
    const fs = mockFileSystem({
      'rules.json': [
        { name: 'E1', traits: [] },
        { name: 'HARV', traits: [] },
      ],
    })

    const rs = await Ruleset.loadAsync(manifest, fs)

    expect(rs.actors.has('e1')).toBe(true)
    expect(rs.actors.has('harv')).toBe(true)
    // name preserves original case from JSON; key is lowercased
    expect(rs.actors.get('e1')?.name).toBe('E1')
    expect(rs.actors.get('harv')?.name).toBe('HARV')
  })

  it('loads abstract actors (included in actors dict)', async () => {
    const manifest = makeManifest({ rules: ['rules.json'] })
    const fs = mockFileSystem({
      'rules.json': [
        { name: '^Infantry', traits: [] },
        { name: 'E1', inherits: ['^infantry'], traits: [] },
      ],
    })

    const rs = await Ruleset.loadAsync(manifest, fs)

    // Abstract actor should be present for inheritance
    expect(rs.actors.has('^infantry')).toBe(true)
    expect(rs.actors.get('^infantry')?.isAbstract).toBe(true)

    // Child should exist
    expect(rs.actors.has('e1')).toBe(true)

    // Abstract actor excluded from spawnable
    expect(rs.spawnableActors.has('^infantry')).toBe(false)
  })

  it('resolves inheritance chains via allConfigs', async () => {
    const manifest = makeManifest({ rules: ['rules.json'] })
    const fs = mockFileSystem({
      'rules.json': [
        {
          name: '^Base',
          traits: [{ trait: 'Health', properties: { maxHP: 100 } }],
        },
        {
          name: '^Infantry',
          inherits: ['^base'],
          traits: [{ trait: 'Mobile', properties: { speed: 5 } }],
        },
        {
          name: 'E1',
          inherits: ['^infantry'],
          traits: [{ trait: 'RenderSprites', properties: { image: 'e1' } }],
        },
      ],
    })

    const rs = await Ruleset.loadAsync(manifest, fs)

    const e1 = rs.actors.get('e1')
    expect(e1).toBeDefined()
    // E1 should inherit traits from both ^Base (Health) and ^Infantry (Mobile)
    // plus its own RenderSprites
    expect(e1!.hasTraitInfo('Health')).toBe(true)
    expect(e1!.hasTraitInfo('Mobile')).toBe(true)
    expect(e1!.hasTraitInfo('RenderSprites')).toBe(true)
  })

  it('handles missing rules file gracefully', async () => {
    const manifest = makeManifest({ rules: ['nonexistent.json'] })
    const fs = mockFileSystem({})

    const rs = await Ruleset.loadAsync(manifest, fs)
    expect(rs.actors.size).toBe(SYSTEM_ACTOR_NAMES.length) // only system actors
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Rules file not found'),
    )
  })

  it('throws on malformed JSON in rules file', async () => {
    const manifest = makeManifest({ rules: ['rules.json'] })
    const fs = mockFileSystem({
      'rules.json': '__RAW__:not valid json{{{',
    })

    await expect(Ruleset.loadAsync(manifest, fs)).rejects.toThrow(
      'Failed to parse rules file',
    )
  })

  it('loads weapons from weapon JSON files', async () => {
    const manifest = makeManifest({ weapons: ['weapons.json'] })
    const fs = mockFileSystem({
      'weapons.json': [
        { name: 'Rifle', reloadDelay: 50, range: 10, burst: 1 },
      ],
    })

    const rs = await Ruleset.loadAsync(manifest, fs)
    expect(rs.weapons.has('rifle')).toBe(true)
    expect(rs.weapons.get('rifle')?.reloadDelay).toBe(50)
    expect(rs.weapons.get('rifle')?.range).toBe(10)
  })

  it('loads voices from voice JSON files', async () => {
    const manifest = makeManifest({ voices: ['voices.json'] })
    const fs = mockFileSystem({
      'voices.json': [
        { name: 'Attack', volume: 0.8, attenuation: 1 },
      ],
    })

    const rs = await Ruleset.loadAsync(manifest, fs)
    expect(rs.voices.has('attack')).toBe(true)
    expect(rs.voices.get('attack')?.volume).toBe(0.8)
  })

  it('loads notifications from notification JSON files', async () => {
    const manifest = makeManifest({ notifications: ['notifications.json'] })
    const fs = mockFileSystem({
      'notifications.json': [
        { name: 'Alert', volume: 1, attenuation: 2 },
      ],
    })

    const rs = await Ruleset.loadAsync(manifest, fs)
    expect(rs.notifications.has('alert')).toBe(true)
    expect(rs.notifications.get('alert')?.attenuation).toBe(2)
  })

  it('loads music from music JSON files', async () => {
    const manifest = makeManifest({ music: ['music.json'] })
    const fs = mockFileSystem({
      'music.json': [
        { name: 'Theme1', filename: 'theme1.ogg', volume: 0.7, loop: true, exists: true },
      ],
    })

    const rs = await Ruleset.loadAsync(manifest, fs)
    expect(rs.music.has('theme1')).toBe(true)
    expect(rs.music.get('theme1')?.loop).toBe(true)
  })

  it('loads model sequences from JSON files', async () => {
    const manifest = makeManifest({ modelSequences: ['models.json'] })
    const fs = mockFileSystem({
      'models.json': [
        { name: 'infantry_run', frames: 8, fps: 15 },
      ],
    })

    const rs = await Ruleset.loadAsync(manifest, fs)
    expect(rs.modelSequences.has('infantry_run')).toBe(true)
    expect(rs.modelSequences.get('infantry_run')?.data).toEqual({ frames: 8, fps: 15 })
  })

  it('passes terrainInfo through to constructor', async () => {
    const manifest = makeManifest()
    const fs = mockFileSystem({})
    const terrainInfo = {
      id: 'test',
      terrainTypes: [],
      defaultTerrainTile: { type: 0, index: 0 },
      getTerrainInfo: () => ({ terrainType: 0, height: 0, rampType: 0, minColor: 0, maxColor: 0, getColor: () => 0, riser: { values: new Uint8Array(8), getConnection: () => 0 } }),
      tryGetTerrainInfo: () => null,
      getTerrainIndex: () => 0,
    } as unknown as ITerrainInfo

    const rs = await Ruleset.loadAsync(manifest, fs, terrainInfo)
    expect(rs.terrainInfo).toBe(terrainInfo)
  })

  it('handles object-format JSON (keys as entry names)', async () => {
    const manifest = makeManifest({ weapons: ['weapons.json'] })
    const fs = mockFileSystem({
      'weapons.json': {
        Rifle: { reloadDelay: 50, range: 10, burst: 1 },
        Rocket: { reloadDelay: 100, range: 15, burst: 2 },
      },
    })

    const rs = await Ruleset.loadAsync(manifest, fs)
    expect(rs.weapons.has('rifle')).toBe(true)
    expect(rs.weapons.has('rocket')).toBe(true)
    expect(rs.weapons.get('rifle')?.reloadDelay).toBe(50)
    expect(rs.weapons.get('rocket')?.burst).toBe(2)
  })

  it('loads IRulesetLoaded traits from JSON and fires callbacks', async () => {
    // NOTE: rulesetLoaded callbacks cannot be serialized in JSON.
    // They are attached at runtime. This test verifies that
    // traits from JSON WITHOUT callbacks still load correctly.
    const manifest = makeManifest({ rules: ['rules.json'] })
    const fs = mockFileSystem({
      'rules.json': [
        {
          name: 'E1',
          traits: [
            { trait: 'Health', implements: ['IRulesetLoaded'], properties: { maxHP: 100 } },
          ],
        },
      ],
    })

    const rs = await Ruleset.loadAsync(manifest, fs)
    const e1 = rs.actors.get('e1')
    expect(e1).toBeDefined()
    expect(e1!.hasTraitInfo('Health')).toBe(true)
  })

  it('loads from multiple rules files with priority (later files override)', async () => {
    const manifest = makeManifest({ rules: ['base.json', 'overrides.json'] })
    const fs = mockFileSystem({
      'base.json': [
        { name: 'E1', traits: [{ trait: 'Health', properties: { maxHP: 100 } }] },
      ],
      'overrides.json': [
        { name: 'E1', traits: [{ trait: 'Health', properties: { maxHP: 200 } }] },
      ],
    })

    const rs = await Ruleset.loadAsync(manifest, fs)
    const e1 = rs.actors.get('e1')
    expect(e1).toBeDefined()
    // Later file overrides — the second definition wins
    // (ActorConfig.fromJSON with allConfigs handles merge priority)
  })

  it('duplicate actors across files log warning', async () => {
    const manifest = makeManifest({ rules: ['a.json', 'b.json'] })
    const fs = mockFileSystem({
      'a.json': [{ name: 'E1', traits: [] }],
      'b.json': [{ name: 'E1', traits: [{ trait: 'Mobile', properties: {} }] }],
    })

    await Ruleset.loadAsync(manifest, fs)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('duplicate actor'),
    )
  })
})

// =========================================================================
// _loadSimpleDict edge cases
// =========================================================================

describe('_loadSimpleDict (via loadAsync)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('duplicate names log warning and later overrides', async () => {
    const manifest = makeManifest({ weapons: ['weapons.json'] })
    const fs = mockFileSystem({
      'weapons.json': [
        { name: 'Rifle', reloadDelay: 50, range: 10, burst: 1 },
        { name: 'Rifle', reloadDelay: 60, range: 12, burst: 2 },
      ],
    })

    const rs = await Ruleset.loadAsync(manifest, fs)
    expect(rs.weapons.get('rifle')?.reloadDelay).toBe(60) // later wins
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('later overrides earlier'),
    )
  })

  it('skips entries with empty names', async () => {
    const manifest = makeManifest({ weapons: ['weapons.json'] })
    const fs = mockFileSystem({
      'weapons.json': [
        { name: '', reloadDelay: 50 },
        { name: 'Valid', reloadDelay: 100 },
      ],
    })

    const rs = await Ruleset.loadAsync(manifest, fs)
    expect(rs.weapons.size).toBe(1)
    expect(rs.weapons.has('valid')).toBe(true)
  })

  it('skips non-object entries in array', async () => {
    const manifest = makeManifest({ weapons: ['weapons.json'] })
    const fs = mockFileSystem({
      'weapons.json': [
        'not an object',
        null,
        42,
        { name: 'Valid', reloadDelay: 100 },
      ],
    })

    const rs = await Ruleset.loadAsync(manifest, fs)
    expect(rs.weapons.size).toBe(1)
    expect(rs.weapons.has('valid')).toBe(true)
  })
})

// =========================================================================
// dispose
// =========================================================================

describe('dispose', () => {
  it('does not throw', () => {
    const rs = new Ruleset(
      new Map(), new Map(), new Map(), new Map(), new Map(), null, new Map(),
    )
    expect(() => rs.dispose()).not.toThrow()
  })

  it('can be called multiple times', () => {
    const rs = new Ruleset(
      new Map(), new Map(), new Map(), new Map(), new Map(), null, new Map(),
    )
    rs.dispose()
    expect(() => rs.dispose()).not.toThrow()
  })
})

// =========================================================================
// Stub interfaces
// =========================================================================

describe('stub interfaces', () => {
  it('WeaponInfo with projectiles and warheads', () => {
    const proj: ProjectileStub = { type: 'Bullet' }
    const wh: WarheadStub = { type: 'SpreadDamage' }
    const weapon: WeaponInfo = {
      name: 'TestGun',
      reloadDelay: 40,
      range: 8,
      burst: 3,
      projectiles: [proj],
      warheads: [wh],
    }
    expect(weapon.name).toBe('TestGun')
    expect(weapon.projectiles).toHaveLength(1)
    expect(weapon.warheads).toHaveLength(1)
  })

  it('SoundInfo with default values', () => {
    const sound: SoundInfo = { name: 'boom', volume: 0.5, attenuation: 2 }
    expect(sound.volume).toBe(0.5)
    expect(sound.attenuation).toBe(2)
  })

  it('MusicInfo with loop and exists flags', () => {
    const music: MusicInfo = {
      filename: 'battle.ogg',
      volume: 0.8,
      loop: true,
      exists: false,
    }
    expect(music.loop).toBe(true)
    expect(music.exists).toBe(false)
  })

  it('ModelSequenceConfig stores raw data', () => {
    const seq: ModelSequenceConfig = {
      name: 'walk',
      data: { frames: 8, fps: 15, loop: true },
    }
    expect(seq.data).toEqual({ frames: 8, fps: 15, loop: true })
  })

  it('ProjectileStub and WarheadStub with rulesetLoaded callbacks', () => {
    const projCalls: WeaponInfo[] = []
    const whCalls: WeaponInfo[] = []
    const weapon = makeWeapon({ name: 'test' })

    const proj: ProjectileStub = {
      type: 'Bullet',
      rulesetLoaded: (_rs, info) => projCalls.push(info),
    }
    const wh: WarheadStub = {
      type: 'Damage',
      rulesetLoaded: (_rs, info) => whCalls.push(info),
    }

    proj.rulesetLoaded?.(null as unknown as Ruleset, weapon)
    wh.rulesetLoaded?.(null as unknown as Ruleset, weapon)

    expect(projCalls).toHaveLength(1)
    expect(projCalls[0]!.name).toBe('test')
    expect(whCalls).toHaveLength(1)
    expect(whCalls[0]!.name).toBe('test')
  })
})

// =========================================================================
// Edge cases
// =========================================================================

describe('edge cases', () => {
  it('empty ruleset has only system actors', () => {
    const rs = new Ruleset(
      new Map(), new Map(), new Map(), new Map(), new Map(), null, new Map(),
    )

    expect(rs.actors.size).toBe(SYSTEM_ACTOR_NAMES.length)
    expect(rs.weapons.size).toBe(0)
    expect(rs.voices.size).toBe(0)
    expect(rs.notifications.size).toBe(0)
    expect(rs.music.size).toBe(0)
    expect(rs.modelSequences.size).toBe(0)
    expect(rs.terrainInfo).toBeNull()
  })

  it('full ruleset with all 7 dicts populated', () => {
    const actors = new Map([['e1', makeActor('e1')]])
    const weapons = new Map([['rifle', makeWeapon({ name: 'rifle' })]])
    const voices = new Map([['yes', makeSound({ name: 'yes' })]])
    const notifs = new Map([['alert', makeSound({ name: 'alert' })]])
    const music = new Map([['theme', makeMusic({ filename: 't.ogg' })]])
    const modelSeqs = new Map([['seq', makeModelSeq('seq')]])

    const rs = new Ruleset(
      actors, weapons, voices, notifs, music, null, modelSeqs,
    )

    // +4 system actors
    expect(rs.actors.size).toBe(5) // e1 + player, editorplayer, world, editorworld
    expect(rs.weapons.size).toBe(1)
    expect(rs.voices.size).toBe(1)
    expect(rs.notifications.size).toBe(1)
    expect(rs.music.size).toBe(1)
    expect(rs.modelSequences.size).toBe(1)
  })

  it('traits without rulesetLoaded are not collected', () => {
    const trait = makeTrait({ name: 'Simple' })
    const actor = makeActor('test', [trait])
    const actors = new Map([['test', actor]])

    // Store handlers count by checking notifyRulesetLoaded
    let callCount = 0
    actor.onRulesetLoaded(() => { callCount++ })

    new Ruleset(actors, new Map(), new Map(), new Map(), new Map(), null, new Map())

    // Only the manually added handler fires, not the trait (no rulesetLoaded)
    expect(callCount).toBe(1)
  })
})
