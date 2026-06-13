/**
 * SubterraneanLocomotor.test.ts — SubterraneanLocomotor migration unit tests
 *
 * Tests focus on:
 * - SubterraneanLocomotorInfo extends LocomotorInfo correctly
 * - Default values for subterranean-specific properties
 * - Custom values via constructor options
 * - DisableDomainPassabilityCheck is always true (overridden)
 * - SubterraneanLocomotor extends Locomotor correctly
 * - SubterraneanLocomotorInfo is also instanceof LocomotorInfo
 * - SubterraneanLocomotor is also instanceof Locomotor
 */

import { describe, it, expect } from 'vitest'
import { WDist } from '../../../OpenRA.Game/WDist'
import { Locomotor, LocomotorInfo, TerrainInfo } from './Locomotor'
import {
  SubterraneanLocomotorInfo,
  SubterraneanLocomotor,
} from './SubterraneanLocomotor'

// ---------------------------------------------------------------------------
// SubterraneanLocomotorInfo
// ---------------------------------------------------------------------------

describe('SubterraneanLocomotorInfo', () => {
  describe('class hierarchy', () => {
    it('extends LocomotorInfo', () => {
      const info = new SubterraneanLocomotorInfo()
      expect(info).toBeInstanceOf(LocomotorInfo)
    })

    it('is also instance of SubterraneanLocomotorInfo', () => {
      const info = new SubterraneanLocomotorInfo()
      expect(info).toBeInstanceOf(SubterraneanLocomotorInfo)
    })
  })

  describe('default values', () => {
    it('SubterraneanTransitionCost defaults to 0', () => {
      const info = new SubterraneanLocomotorInfo()
      expect(info.SubterraneanTransitionCost).toBe(0)
    })

    it('SubterraneanTransitionTerrainTypes defaults to empty set', () => {
      const info = new SubterraneanLocomotorInfo()
      expect(info.SubterraneanTransitionTerrainTypes).toBeInstanceOf(Set)
      expect(info.SubterraneanTransitionTerrainTypes.size).toBe(0)
    })

    it('SubterraneanTransitionOnRamps defaults to false', () => {
      const info = new SubterraneanLocomotorInfo()
      expect(info.SubterraneanTransitionOnRamps).toBe(false)
    })

    it('SubterraneanTransitionDepth defaults to -1024 WDist', () => {
      const info = new SubterraneanLocomotorInfo()
      expect(info.SubterraneanTransitionDepth.length).toBe(-1024)
      expect(info.SubterraneanTransitionDepth).toBeInstanceOf(WDist)
    })

    it('DisableDomainPassabilityCheck is always true (overridden)', () => {
      const info = new SubterraneanLocomotorInfo()
      expect(info.DisableDomainPassabilityCheck).toBe(true)
    })

    it('inherits LocomotorInfo default Name', () => {
      const info = new SubterraneanLocomotorInfo()
      expect(info.Name).toBe('default')
    })

    it('inherits LocomotorInfo default WaitAverage', () => {
      const info = new SubterraneanLocomotorInfo()
      expect(info.WaitAverage).toBe(40)
    })
  })

  describe('custom values', () => {
    it('sets SubterraneanTransitionCost from opts', () => {
      const info = new SubterraneanLocomotorInfo({ subterraneanTransitionCost: 50 })
      expect(info.SubterraneanTransitionCost).toBe(50)
    })

    it('sets SubterraneanTransitionTerrainTypes from opts', () => {
      const types = new Set(['Ore', 'Beach'])
      const info = new SubterraneanLocomotorInfo({
        subterraneanTransitionTerrainTypes: types,
      })
      expect(info.SubterraneanTransitionTerrainTypes).toBe(types)
      expect(info.SubterraneanTransitionTerrainTypes.has('Ore')).toBe(true)
    })

    it('sets SubterraneanTransitionOnRamps from opts', () => {
      const info = new SubterraneanLocomotorInfo({ subterraneanTransitionOnRamps: true })
      expect(info.SubterraneanTransitionOnRamps).toBe(true)
    })

    it('sets SubterraneanTransitionDepth from opts', () => {
      const depth = new WDist(-512)
      const info = new SubterraneanLocomotorInfo({ subterraneanTransitionDepth: depth })
      expect(info.SubterraneanTransitionDepth).toBe(depth)
      expect(info.SubterraneanTransitionDepth.length).toBe(-512)
    })

    it('accepts name and passes to LocomotorInfo', () => {
      const info = new SubterraneanLocomotorInfo({ name: 'subterranean-infantry' })
      expect(info.Name).toBe('subterranean-infantry')
    })

    it('DisableDomainPassabilityCheck stays true even when set to false in opts', () => {
      // The override property getter always returns true regardless of opts
      const info = new SubterraneanLocomotorInfo()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(info.DisableDomainPassabilityCheck).toBe(true)
    })

    it('accepts LocomotorInfo parent fields', () => {
      const terrainSpeeds = new Map([
        ['Subterranean', new TerrainInfo(80, 120)],
      ])
      const info = new SubterraneanLocomotorInfo({
        name: 'drill',
        sharesCell: false,
        waitAverage: 25,
        terrainSpeeds,
      })
      expect(info.Name).toBe('drill')
      expect(info.SharesCell).toBe(false)
      expect(info.WaitAverage).toBe(25)
      expect(info.TerrainSpeeds.get('Subterranean')?.Speed).toBe(80)
    })
  })
})

// ---------------------------------------------------------------------------
// SubterraneanLocomotor
// ---------------------------------------------------------------------------

describe('SubterraneanLocomotor', () => {
  describe('class hierarchy', () => {
    it('extends Locomotor', () => {
      const info = new SubterraneanLocomotorInfo({ name: 'drill' })
      // Minimal world mock — SubterraneanLocomotor just delegates to base Locomotor
      const world = createMinimalWorld()
      const locomotor = new SubterraneanLocomotor(world, info)
      expect(locomotor).toBeInstanceOf(Locomotor)
      expect(locomotor).toBeInstanceOf(SubterraneanLocomotor)
    })
  })

  describe('Info property', () => {
    it('returns the SubterraneanLocomotorInfo passed to constructor', () => {
      const info = new SubterraneanLocomotorInfo({
        name: 'drill',
        subterraneanTransitionCost: 30,
      })
      const world = createMinimalWorld()
      const locomotor = new SubterraneanLocomotor(world, info)
      expect(locomotor.Info).toBe(info)
      expect(locomotor.Info.SubterraneanTransitionCost).toBe(30)
    })

    it('Info is instance of SubterraneanLocomotorInfo', () => {
      const info = new SubterraneanLocomotorInfo()
      const world = createMinimalWorld()
      const locomotor = new SubterraneanLocomotor(world, info)
      expect(locomotor.Info).toBeInstanceOf(SubterraneanLocomotorInfo)
      expect(locomotor.Info.DisableDomainPassabilityCheck).toBe(true)
    })
  })

  describe('inherited behavior', () => {
    it('sharesCell matches Info.SharesCell', () => {
      const info = new SubterraneanLocomotorInfo({ sharesCell: true })
      const world = createMinimalWorld()
      const locomotor = new SubterraneanLocomotor(world, info)
      expect(locomotor.sharesCell).toBe(true)
    })

    it('sharesCell is false by default', () => {
      const info = new SubterraneanLocomotorInfo()
      const world = createMinimalWorld()
      const locomotor = new SubterraneanLocomotor(world, info)
      expect(locomotor.sharesCell).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import type { ILocomotorWorld, ILocomotorMap, ILocomotorActorMap } from './Locomotor'
import type { LongBitSet } from '../../../OpenRA.Game/Primitives/LongBitSet'
import type { PlayerBitMask } from './Locomotor'
import { MapGridType } from '../../../OpenRA.Game/Map/MapGridType'
import { CellLayer } from '../../../OpenRA.Game/Map/CellLayer'
import { SubCell } from '../../../OpenRA.Game/Traits/SubCell'
import type { SubCell as SubCellType } from '../../../OpenRA.Game/Traits/SubCell'
import { CPos } from '../../../OpenRA.Game/CPos'

function createMinimalWorld(): ILocomotorWorld {
  const gridType: import('../../../OpenRA.Game/Map/MapGridType').MapGridType = MapGridType.Rectangular
  const mapSize = { width: 16, height: 16 }

  const map: ILocomotorMap = {
    contains: () => true,
    grid: { maximumTerrainHeight: 0 },
    height: new CellLayer<number>(gridType, mapSize),
    getTerrainIndex: () => 0,
    tiles: {
      onCellEntryChanged: () => {},
    },
    customTerrain: {
      onCellEntryChanged: () => {},
    },
    rules: {
      terrainInfo: {
        TerrainTypes: [{ Type: 'Clear' }],
      },
    },
    mapSize,
    gridType,
    allCells: function* () {
      for (let y = 0; y < mapSize.height; y++) {
        for (let x = 0; x < mapSize.width; x++) {
          yield new CPos(x, y)
        }
      }
    },
  }

  // Use `as` cast: overloaded interface methods are implementation-compatible.
  // SubterraneanLocomotor constructor does NOT call into actorMap methods,
  // so minimal stubs suffice.
  const actorMap = {
    getActorsAt(_cell: CPos, _subCell?: unknown): unknown[] {
      return []
    },
    anyActorsAt(_cell: CPos, _subCell: unknown, _withCondition?: (a: unknown) => boolean): boolean {
      return false
    },
    hasFreeSubCell(_cell: CPos): boolean {
      return true
    },
    freeSubCell(_cell: CPos, _preferredSubCell: unknown, _checkIfBlocker?: (a: unknown) => boolean): SubCellType {
      return SubCell.FullCell as SubCellType
    },
    onCellUpdated: null,
  } as ILocomotorActorMap

  return {
    map,
    actorMap,
    allPlayersMask: undefined as unknown as LongBitSet<PlayerBitMask>,
    noPlayersMask: undefined as unknown as LongBitSet<PlayerBitMask>,
    rulesContainTemporaryBlocker: false,
    getCustomMovementLayers: () => [],
  }
}
