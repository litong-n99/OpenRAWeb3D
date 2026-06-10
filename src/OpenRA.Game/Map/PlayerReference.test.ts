/**
 * PlayerReference.test.ts — PlayerReference migration unit tests
 *
 * Tests focus on: construction with defaults, construction from partial
 * object, field assignment, and toString() behavior.
 */

import { describe, it, expect } from 'vitest'
import { PlayerReference } from './PlayerReference.js'
import { CPos } from '../CPos.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlayerReference', () => {
  describe('default constructor', () => {
    it('creates instance with all default values', () => {
      const pr = new PlayerReference()

      expect(pr.name).toBe('')
      expect(pr.palette).toBe('')
      expect(pr.bot).toBeNull()
      expect(pr.startingUnitsClass).toBeNull()
      expect(pr.allowBots).toBe(true)
      expect(pr.playable).toBe(false)
      expect(pr.required).toBe(false)
      expect(pr.ownsWorld).toBe(false)
      expect(pr.spectating).toBe(false)
      expect(pr.nonCombatant).toBe(false)
      expect(pr.lockFaction).toBe(false)
      expect(pr.faction).toBe('')
      expect(pr.lockColor).toBe(false)
      expect(pr.color).toBe(0xffffffff)
      expect(pr.homeLocation).toBe(CPos.Zero)
      expect(pr.lockSpawn).toBe(false)
      expect(pr.spawn).toBe(0)
      expect(pr.lockTeam).toBe(false)
      expect(pr.team).toBe(0)
      expect(pr.lockHandicap).toBe(false)
      expect(pr.handicap).toBe(0)
      expect(pr.allies).toEqual([])
      expect(pr.enemies).toEqual([])
    })

    it('toString returns empty name for default instance', () => {
      const pr = new PlayerReference()
      expect(pr.toString()).toBe('')
    })
  })

  describe('constructor with partial object', () => {
    it('assigns provided fields and uses defaults for others', () => {
      const pr = new PlayerReference({
        name: 'Multi0',
        playable: true,
        faction: 'Random',
      })

      expect(pr.name).toBe('Multi0')
      expect(pr.playable).toBe(true)
      expect(pr.faction).toBe('Random')
      // Defaults for unspecified fields
      expect(pr.allowBots).toBe(true)
      expect(pr.bot).toBeNull()
      expect(pr.color).toBe(0xffffffff)
    })

    it('copies allies and enemies arrays', () => {
      const allies = ['Multi1', 'Multi2']
      const enemies = ['Creeps']
      const pr = new PlayerReference({
        name: 'Test',
        allies,
        enemies,
      })

      expect(pr.allies).toEqual(['Multi1', 'Multi2'])
      expect(pr.enemies).toEqual(['Creeps'])
      // Should be a copy, not the same reference
      expect(pr.allies).not.toBe(allies)
      expect(pr.enemies).not.toBe(enemies)
    })

    it('handles all field overrides', () => {
      const pr = new PlayerReference({
        name: 'Neutral',
        palette: 'player',
        bot: 'RushAI',
        startingUnitsClass: 'mcvonly',
        allowBots: false,
        playable: true,
        required: true,
        ownsWorld: true,
        spectating: false,
        nonCombatant: true,
        lockFaction: true,
        faction: 'Allies',
        lockColor: true,
        color: 0xffff0000,
        homeLocation: new CPos(5, 10),
        lockSpawn: true,
        spawn: 3,
        lockTeam: true,
        team: 1,
        lockHandicap: true,
        handicap: 50,
        allies: ['Multi0'],
        enemies: ['Creeps'],
      })

      expect(pr.name).toBe('Neutral')
      expect(pr.palette).toBe('player')
      expect(pr.bot).toBe('RushAI')
      expect(pr.startingUnitsClass).toBe('mcvonly')
      expect(pr.allowBots).toBe(false)
      expect(pr.playable).toBe(true)
      expect(pr.required).toBe(true)
      expect(pr.ownsWorld).toBe(true)
      expect(pr.spectating).toBe(false)
      expect(pr.nonCombatant).toBe(true)
      expect(pr.lockFaction).toBe(true)
      expect(pr.faction).toBe('Allies')
      expect(pr.lockColor).toBe(true)
      expect(pr.color).toBe(0xffff0000)
      expect(pr.homeLocation).toEqual(new CPos(5, 10))
      expect(pr.lockSpawn).toBe(true)
      expect(pr.spawn).toBe(3)
      expect(pr.lockTeam).toBe(true)
      expect(pr.team).toBe(1)
      expect(pr.lockHandicap).toBe(true)
      expect(pr.handicap).toBe(50)
      expect(pr.allies).toEqual(['Multi0'])
      expect(pr.enemies).toEqual(['Creeps'])
    })
  })

  describe('toString', () => {
    it('returns the player name', () => {
      const pr = new PlayerReference({ name: 'Multi5' })
      expect(pr.toString()).toBe('Multi5')
    })
  })

  describe('edge cases', () => {
    it('handles empty arrays correctly', () => {
      const pr = new PlayerReference({ allies: [], enemies: [] })
      expect(pr.allies).toEqual([])
      expect(pr.enemies).toEqual([])
    })

    it('preserves CPos homeLocation', () => {
      const home = new CPos(42, 99, 1)
      const pr = new PlayerReference({ homeLocation: home })
      expect(pr.homeLocation.X).toBe(42)
      expect(pr.homeLocation.Y).toBe(99)
      expect(pr.homeLocation.Layer).toBe(1)
    })

    it('uses white as default color', () => {
      const pr = new PlayerReference()
      expect(pr.color).toBe(0xffffffff)
    })
  })
})
