/**
 * D2kBuilding.test.ts — D2kBuilding migration unit tests
 *
 * Tests focus on: building info configuration, concrete placement, terrain damage
 * threshold calculation, tick damage application, building lifecycle.
 */

import { describe, it, expect, vi } from 'vitest'

import {
  D2kBuilding,
  D2kBuildingInfo,
  type IHealthMinimal,
} from './D2kBuilding.js'
import { Building, BuildingInfo, type IBuildingMap } from '../../../OpenRA.Mods.Common/Traits/Buildings/Building.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockMap(): IBuildingMap {
  return {
    centerOfCell: vi.fn((cell: CPos) => new WPos(cell.X * 1024, cell.Y * 1024, 0)),
  }
}

function createMockActor(overrides: Partial<Record<string, unknown>> = {}): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    generation: 1,
    owner: {
      playerId: 0,
      playerName: 'Test',
      playerActor: { TechTree: { hasPrerequisites: vi.fn(() => true) } },
    },
    world: {
      map: { getTerrainInfo: vi.fn(() => ({ type: 'Sand' })) },
      worldActor: {
        BuildableTerrainLayer: null,
        BuildingInfluence: null,
      } as unknown as IGameActor,
    },
    centerPosition: new WPos(0, 0, 0),
    ...overrides,
  } as unknown as IGameActor
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('D2kBuilding', () => {
  describe('D2kBuildingInfo', () => {
    it('extends BuildingInfo', () => {
      const info = new D2kBuildingInfo()
      expect(info).toBeInstanceOf(BuildingInfo)
    })

    it('has D2K-specific defaults', () => {
      const info = new D2kBuildingInfo()
      expect(info.damage).toBe(500)
      expect(info.damageInterval).toBe(100)
      expect(info.damageThreshold).toBe(50)
      expect(info.startOnThreshold).toBe(true)
      expect(info.concreteTemplate).toBe(88)
      expect(info.damageTerrainTypes).toContain('Rock')
    })

    it('accepts custom config', () => {
      const info = new D2kBuildingInfo({
        damage: 1000,
        damageInterval: 50,
        damageThreshold: 30,
        startOnThreshold: false,
        concreteTemplate: 90,
        damageTerrainTypes: ['Rock', 'Cliff'],
        damageTypes: ['Explosion'],
      })
      expect(info.damage).toBe(1000)
      expect(info.damageThreshold).toBe(30)
      expect(info.startOnThreshold).toBe(false)
      expect(info.concreteTemplate).toBe(90)
    })

    it('propagates base BuildingInfo config', () => {
      const info = new D2kBuildingInfo({
        terrainTypes: ['Sand', 'Concrete'],
        requiresBaseProvider: true,
        buildSounds: ['concrete.wav'],
      })
      expect(info.terrainTypes.has('Sand')).toBe(true)
      expect(info.requiresBaseProvider).toBe(true)
      expect(info.buildSounds).toContain('concrete.wav')
    })
  })

  describe('D2kBuilding extends Building', () => {
    it('extends Building class', () => {
      const info = new D2kBuildingInfo()
      const topLeft = new CPos(5, 5)
      const map = createMockMap()

      const building = new D2kBuilding(info, topLeft, map)
      expect(building).toBeInstanceOf(D2kBuilding)
      expect(building).toBeInstanceOf(Building)
    })

    it('stores D2K info', () => {
      const info = new D2kBuildingInfo({ damage: 750 })
      const topLeft = new CPos(3, 3)
      const map = createMockMap()

      const building = new D2kBuilding(info, topLeft, map)
      expect(building.d2kInfo.damage).toBe(750)
    })

    it('has correct topLeft position', () => {
      const info = new D2kBuildingInfo()
      const topLeft = new CPos(7, 8)
      const map = createMockMap()

      const building = new D2kBuilding(info, topLeft, map)
      expect(building.topLeft).toEqual(topLeft)
    })
  })

  describe('created', () => {
    it('resolves health and other dependencies', () => {
      const info = new D2kBuildingInfo()
      const topLeft = new CPos(5, 5)
      const map = createMockMap()
      const health: IHealthMinimal = {
        maxHP: 1000,
        hp: 1000,
        inflictDamage: vi.fn(),
      }
      const actor = createMockActor({ Health: health })

      const building = new D2kBuilding(info, topLeft, map)
      building.created(actor)
      // Should not throw
    })
  })

  describe('addedToWorld', () => {
    it('completes without error when health is available', () => {
      const info = new D2kBuildingInfo({
        damageTerrainTypes: ['Rock'],
        startOnThreshold: false,
      })
      const topLeft = new CPos(2, 2)
      const map = createMockMap()
      const health: IHealthMinimal = {
        maxHP: 1000,
        hp: 1000,
        inflictDamage: vi.fn(),
      }
      const actor = createMockActor({ Health: health })

      const building = new D2kBuilding(info, topLeft, map)
      building.created(actor)
      expect(() => building.addedToWorld(actor)).not.toThrow()
    })

    it('handles missing health gracefully', () => {
      const info = new D2kBuildingInfo()
      const topLeft = new CPos(4, 4)
      const map = createMockMap()
      const building = new D2kBuilding(info, topLeft, map)

      expect(() => building.addedToWorld(createMockActor())).not.toThrow()
    })
  })

  describe('tick', () => {
    it('does not apply damage when totalTiles equals safeTiles', () => {
      const info = new D2kBuildingInfo({
        damageTerrainTypes: ['Rock'],
        damageInterval: 100,
      })
      const topLeft = new CPos(1, 1)
      const map = createMockMap()
      const health: IHealthMinimal = {
        maxHP: 1000,
        hp: 1000,
        inflictDamage: vi.fn(),
      }
      const actor = createMockActor({ Health: health })

      const building = new D2kBuilding(info, topLeft, map)
      building.created(actor)
      building.addedToWorld(actor)

      // When totalTiles === safeTiles, tick should no-op
      building.tick(actor)
      expect(health.inflictDamage).not.toHaveBeenCalled()
    })
  })

  describe('damage threshold calculation', () => {
    it('calculates damage threshold from safe tile ratio', () => {
      const info = new D2kBuildingInfo({
        damageTerrainTypes: ['Rock'],
        damageThreshold: 50,
        startOnThreshold: false,
      })
      const topLeft = new CPos(2, 2)
      const map = createMockMap()
      const health: IHealthMinimal = {
        maxHP: 1000,
        hp: 1000,
        inflictDamage: vi.fn(),
      }
      const actor = createMockActor({ Health: health })

      const building = new D2kBuilding(info, topLeft, map)
      building.created(actor)
      building.addedToWorld(actor)

      // All safe → totalTiles === safeTiles → threshold stays at 0
      expect(building.damageThreshold).toBe(0)
    })
  })
})
