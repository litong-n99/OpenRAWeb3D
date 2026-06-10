/**
 * MapPlayers.test.ts — MapPlayers migration unit tests
 *
 * Tests focus on: default construction, player definition parsing,
 * skirmish configuration generation, serialization, and edge cases.
 */

import { describe, it, expect } from 'vitest'
import { MapPlayers } from './MapPlayers.js'
import { PlayerReference } from './PlayerReference.js'
import type { RulesetStub } from '../Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MapPlayers', () => {
  describe('MaximumPlayerCount', () => {
    it('equals 63', () => {
      expect(MapPlayers.MaximumPlayerCount).toBe(63)
    })
  })

  describe('default constructor', () => {
    it('creates empty players map', () => {
      const mp = new MapPlayers()
      expect(mp.players.size).toBe(0)
    })
  })

  describe('constructor with player definitions', () => {
    it('creates players from definitions', () => {
      const defs = [
        {
          name: 'Neutral',
          nodes: [],
        },
        {
          name: 'Multi0',
          nodes: [],
        },
      ]

      const mp = new MapPlayers(defs)

      expect(mp.players.size).toBe(2)
      expect(mp.players.has('Neutral')).toBe(true)
      expect(mp.players.has('Multi0')).toBe(true)
    })

    it('creates PlayerReference instances from definitions', () => {
      const defs = [
        {
          name: 'TestPlayer',
          nodes: [],
        },
      ]

      const mp = new MapPlayers(defs)
      const player = mp.players.get('TestPlayer')

      expect(player).toBeInstanceOf(PlayerReference)
      expect(player!.name).toBe('TestPlayer')
    })

    it('handles empty definitions array', () => {
      const mp = new MapPlayers([])
      expect(mp.players.size).toBe(0)
    })
  })

  describe('constructor with rules and player count', () => {
    it('creates Neutral, Creeps, and Multi players for 2-player skirmish', () => {
      const rules: RulesetStub = { actors: new Map() }
      const mp = new MapPlayers(rules, 2)

      expect(mp.players.size).toBe(4) // Neutral + Creeps + Multi0 + Multi1
      expect(mp.players.has('Neutral')).toBe(true)
      expect(mp.players.has('Creeps')).toBe(true)
      expect(mp.players.has('Multi0')).toBe(true)
      expect(mp.players.has('Multi1')).toBe(true)
    })

    it('creates only Neutral and Creeps for 0 players', () => {
      const rules: RulesetStub = { actors: new Map() }
      const mp = new MapPlayers(rules, 0)

      expect(mp.players.size).toBe(2)
      expect(mp.players.has('Neutral')).toBe(true)
      expect(mp.players.has('Creeps')).toBe(true)
    })

    it('sets Neutral with ownsWorld and nonCombatant', () => {
      const rules: RulesetStub = { actors: new Map() }
      const mp = new MapPlayers(rules, 1)

      const neutral = mp.players.get('Neutral')!
      expect(neutral.ownsWorld).toBe(true)
      expect(neutral.nonCombatant).toBe(true)
      expect(neutral.playable).toBe(false)
    })

    it('sets Creeps with nonCombatant and enemies as all Multi players', () => {
      const rules: RulesetStub = { actors: new Map() }
      const mp = new MapPlayers(rules, 3)

      const creeps = mp.players.get('Creeps')!
      expect(creeps.nonCombatant).toBe(true)
      expect(creeps.enemies).toEqual(['Multi0', 'Multi1', 'Multi2'])
    })

    it('sets Multi players with playable=true and faction=Random', () => {
      const rules: RulesetStub = { actors: new Map() }
      const mp = new MapPlayers(rules, 2)

      const multi0 = mp.players.get('Multi0')!
      expect(multi0.playable).toBe(true)
      expect(multi0.faction).toBe('Random')
      expect(multi0.enemies).toEqual(['Creeps'])

      const multi1 = mp.players.get('Multi1')!
      expect(multi1.playable).toBe(true)
      expect(multi1.faction).toBe('Random')
      expect(multi1.enemies).toEqual(['Creeps'])
    })

    it('uses first selectable faction from ruleset', () => {
      const rules: RulesetStub = {
        actors: new Map([
          ['World', {
            factions: [
              { selectable: false, internalName: 'BadFaction' },
              { selectable: true, internalName: 'GoodFaction' },
            ],
          }],
        ]),
      }
      const mp = new MapPlayers(rules, 1)

      const neutral = mp.players.get('Neutral')!
      expect(neutral.faction).toBe('GoodFaction')

      const creeps = mp.players.get('Creeps')!
      expect(creeps.faction).toBe('GoodFaction')
    })

    it('falls back to "Random" when no selectable faction found', () => {
      const rules: RulesetStub = { actors: new Map() }
      const mp = new MapPlayers(rules, 1)

      const neutral = mp.players.get('Neutral')!
      expect(neutral.faction).toBe('Random')
    })
  })

  describe('toMiniYaml', () => {
    it('serializes all players', () => {
      const rules: RulesetStub = { actors: new Map() }
      const mp = new MapPlayers(rules, 1)
      const yaml = mp.toMiniYaml()

      expect(yaml).toHaveLength(3)
      expect(yaml[0]!.key).toBe('PlayerReference@Neutral')
      expect(yaml[1]!.key).toBe('PlayerReference@Creeps')
      expect(yaml[2]!.key).toBe('PlayerReference@Multi0')
    })

    it('only includes fields that differ from defaults', () => {
      const rules: RulesetStub = { actors: new Map() }
      const mp = new MapPlayers(rules, 1)
      const yaml = mp.toMiniYaml()

      // Neutral has ownsWorld and nonCombatant set
      const neutralYaml = yaml.find(y => y.key === 'PlayerReference@Neutral')!
      expect(neutralYaml.value.OwnsWorld).toBe(true)
      expect(neutralYaml.value.NonCombatant).toBe(true)
      // Should NOT include fields that match defaults (like Playable=false)
      expect(neutralYaml.value.Playable).toBeUndefined()
    })

    it('includes enemies array for Creeps', () => {
      const rules: RulesetStub = { actors: new Map() }
      const mp = new MapPlayers(rules, 2)
      const yaml = mp.toMiniYaml()

      const creepsYaml = yaml.find(y => y.key === 'PlayerReference@Creeps')!
      expect(creepsYaml.value.Enemies).toEqual(['Multi0', 'Multi1'])
    })

    it('includes enemies array for Multi players', () => {
      const rules: RulesetStub = { actors: new Map() }
      const mp = new MapPlayers(rules, 1)
      const yaml = mp.toMiniYaml()

      const multiYaml = yaml.find(y => y.key === 'PlayerReference@Multi0')!
      expect(multiYaml.value.Enemies).toEqual(['Creeps'])
      expect(multiYaml.value.Playable).toBe(true)
      expect(multiYaml.value.Faction).toBe('Random')
    })

    it('returns empty array for empty players map', () => {
      const mp = new MapPlayers()
      expect(mp.toMiniYaml()).toEqual([])
    })
  })

  describe('edge cases', () => {
    it('handles large player count', () => {
      const rules: RulesetStub = { actors: new Map() }
      const mp = new MapPlayers(rules, 63)

      expect(mp.players.size).toBe(65) // Neutral + Creeps + 63 Multi
      expect(mp.players.has('Multi62')).toBe(true)
    })

    it('Creeps enemies list is empty for 0 players', () => {
      const rules: RulesetStub = { actors: new Map() }
      const mp = new MapPlayers(rules, 0)
      const creeps = mp.players.get('Creeps')!
      expect(creeps.enemies).toEqual([])
    })
  })
})
