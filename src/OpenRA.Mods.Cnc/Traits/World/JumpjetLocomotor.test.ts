/**
 * JumpjetLocomotor.test.ts — JumpjetLocomotor migration unit tests
 *
 * Tests focus on:
 * - JumpjetLocomotorInfo extends LocomotorInfo correctly
 * - Default values for jumpjet-specific properties
 * - Custom values via constructor options
 * - DisableDomainPassabilityCheck is always true (overridden)
 * - JumpjetLocomotor extends Locomotor correctly
 * - JumpjetLocomotorInfo is also instanceof LocomotorInfo
 * - JumpjetLocomotor is also instanceof Locomotor
 */

import { describe, it, expect } from 'vitest'
import { Locomotor, LocomotorInfo, TerrainInfo } from '../../../OpenRA.Mods.Common/Traits/World/Locomotor.js'
import {
  JumpjetLocomotorInfo,
  JumpjetLocomotor,
} from './JumpjetLocomotor.js'

// ---------------------------------------------------------------------------
// JumpjetLocomotorInfo
// ---------------------------------------------------------------------------

describe('JumpjetLocomotorInfo', () => {
  describe('class hierarchy', () => {
    it('extends LocomotorInfo', () => {
      const info = new JumpjetLocomotorInfo()
      expect(info).toBeInstanceOf(LocomotorInfo)
    })

    it('is also instance of JumpjetLocomotorInfo', () => {
      const info = new JumpjetLocomotorInfo()
      expect(info).toBeInstanceOf(JumpjetLocomotorInfo)
    })
  })

  describe('default values', () => {
    it('JumpjetTransitionCost defaults to 0', () => {
      const info = new JumpjetLocomotorInfo()
      expect(info.JumpjetTransitionCost).toBe(0)
    })

    it('JumpjetTransitionTerrainTypes defaults to empty set', () => {
      const info = new JumpjetLocomotorInfo()
      expect(info.JumpjetTransitionTerrainTypes).toBeInstanceOf(Set)
      expect(info.JumpjetTransitionTerrainTypes.size).toBe(0)
    })

    it('JumpjetTransitionOnRamps defaults to true', () => {
      const info = new JumpjetLocomotorInfo()
      expect(info.JumpjetTransitionOnRamps).toBe(true)
    })

    it('DisableDomainPassabilityCheck is always true (overridden)', () => {
      const info = new JumpjetLocomotorInfo()
      expect(info.DisableDomainPassabilityCheck).toBe(true)
    })

    it('inherits LocomotorInfo default Name', () => {
      const info = new JumpjetLocomotorInfo()
      expect(info.Name).toBe('default')
    })

    it('inherits LocomotorInfo default WaitAverage', () => {
      const info = new JumpjetLocomotorInfo()
      expect(info.WaitAverage).toBe(40)
    })
  })

  describe('custom values', () => {
    it('sets JumpjetTransitionCost from opts', () => {
      const info = new JumpjetLocomotorInfo({ jumpjetTransitionCost: 150 })
      expect(info.JumpjetTransitionCost).toBe(150)
    })

    it('sets JumpjetTransitionTerrainTypes from opts', () => {
      const types = new Set(['Clear', 'Road'])
      const info = new JumpjetLocomotorInfo({
        jumpjetTransitionTerrainTypes: types,
      })
      expect(info.JumpjetTransitionTerrainTypes).toBe(types)
      expect(info.JumpjetTransitionTerrainTypes.has('Clear')).toBe(true)
      expect(info.JumpjetTransitionTerrainTypes.has('Road')).toBe(true)
    })

    it('sets JumpjetTransitionOnRamps from opts', () => {
      const info = new JumpjetLocomotorInfo({ jumpjetTransitionOnRamps: false })
      expect(info.JumpjetTransitionOnRamps).toBe(false)
    })

    it('accepts name and passes to LocomotorInfo', () => {
      const info = new JumpjetLocomotorInfo({ name: 'jumpjet-infantry' })
      expect(info.Name).toBe('jumpjet-infantry')
    })

    it('DisableDomainPassabilityCheck stays true even when opts tries to override', () => {
      const info = new JumpjetLocomotorInfo()
      expect(info.DisableDomainPassabilityCheck).toBe(true)
    })

    it('accepts LocomotorInfo parent fields', () => {
      const terrainSpeeds = new Map([
        ['Clear', new TerrainInfo(100, 100)],
      ])
      const info = new JumpjetLocomotorInfo({
        name: 'jumpjet',
        sharesCell: false,
        waitAverage: 20,
        terrainSpeeds,
      })
      expect(info.Name).toBe('jumpjet')
      expect(info.SharesCell).toBe(false)
      expect(info.WaitAverage).toBe(20)
      expect(info.TerrainSpeeds.get('Clear')?.Speed).toBe(100)
    })
  })
})

// ---------------------------------------------------------------------------
// JumpjetLocomotor
// ---------------------------------------------------------------------------

describe('JumpjetLocomotor', () => {
  describe('class hierarchy', () => {
    it('extends Locomotor', () => {
      const info = new JumpjetLocomotorInfo({ name: 'jumpjet' })
      const world = createMinimalWorld()
      const locomotor = new JumpjetLocomotor(world, info)
      expect(locomotor).toBeInstanceOf(Locomotor)
      expect(locomotor).toBeInstanceOf(JumpjetLocomotor)
    })
  })

  describe('Info property', () => {
    it('returns the JumpjetLocomotorInfo passed to constructor', () => {
      const info = new JumpjetLocomotorInfo({
        name: 'jumpjet',
        jumpjetTransitionCost: 30,
      })
      const world = createMinimalWorld()
      const locomotor = new JumpjetLocomotor(world, info)
      expect(locomotor.Info).toBe(info)
      expect(locomotor.Info.JumpjetTransitionCost).toBe(30)
    })

    it('Info is instance of JumpjetLocomotorInfo', () => {
      const info = new JumpjetLocomotorInfo()
      const world = createMinimalWorld()
      const locomotor = new JumpjetLocomotor(world, info)
      expect(locomotor.Info).toBeInstanceOf(JumpjetLocomotorInfo)
      expect(locomotor.Info.DisableDomainPassabilityCheck).toBe(true)
    })
  })

  describe('inherited behavior', () => {
    it('sharesCell matches Info.SharesCell', () => {
      const info = new JumpjetLocomotorInfo({ sharesCell: true })
      const world = createMinimalWorld()
      const locomotor = new JumpjetLocomotor(world, info)
      expect(locomotor.sharesCell).toBe(true)
    })

    it('sharesCell is false by default', () => {
      const info = new JumpjetLocomotorInfo()
      const world = createMinimalWorld()
      const locomotor = new JumpjetLocomotor(world, info)
      expect(locomotor.sharesCell).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import type { ILocomotorWorld, ILocomotorMap, ILocomotorActorMap } from '../../../OpenRA.Mods.Common/Traits/World/Locomotor.js'
import type { LongBitSet } from '../../../OpenRA.Game/Primitives/LongBitSet.js'
import type { PlayerBitMask } from '../../../OpenRA.Mods.Common/Traits/World/Locomotor.js'
import { MapGridType } from '../../../OpenRA.Game/Map/MapGridType.js'
import { CellLayer } from '../../../OpenRA.Game/Map/CellLayer.js'
import { SubCell } from '../../../OpenRA.Game/Traits/SubCell.js'
import type { SubCell as SubCellType } from '../../../OpenRA.Game/Traits/SubCell.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'

function createMinimalWorld(): ILocomotorWorld {
  const gridType: import('../../../OpenRA.Game/Map/MapGridType.js').MapGridType = MapGridType.Rectangular
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
  // JumpjetLocomotor constructor does NOT call into actorMap methods,
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
