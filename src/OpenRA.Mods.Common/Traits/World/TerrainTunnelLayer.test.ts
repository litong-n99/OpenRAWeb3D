/**
 * TerrainTunnelLayer.test.ts -- TerrainTunnelLayer unit tests
 *
 * Tests focus on: ICustomMovementLayer compliance, portal management,
 * entry/exit movement costs, cell center computation.
 */

import { describe, it, expect, vi } from 'vitest'
import { TerrainTunnelLayer, TerrainTunnelLayerInfo } from './TerrainTunnelLayer'
import { CustomMovementLayerType, type LocomotorInfo } from './Locomotor'
import { TerrainTunnelInfo } from './TerrainTunnel'
import { CPos } from '../../../OpenRA.Game/CPos'
import { CVec } from '../../../OpenRA.Game/CVec'
import { WPos } from '../../../OpenRA.Game/WPos'
import { PathGraph } from '../../Pathfinder/IPathGraph'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockWorld(tunnelInfos: TerrainTunnelInfo[]): {
  worldStub: Record<string, unknown>
  centerOfCellCalls: CPos[]
} {
  const centerOfCellCalls: CPos[] = []
  const centerOfCell = vi.fn((c: CPos) => {
    centerOfCellCalls.push(c)
    return new WPos(c.X * 1024, c.Y * 1024, 0)
  })

  const worldStub: Record<string, unknown> = {
    actors: [] as unknown[],
    worldActor: {
      info: {
        traitInfos: () => tunnelInfos,
      },
    },
    map: {
      centerOfCell,
      cellHeightStep: { length: 512 },
      rules: {
        terrainInfo: {
          getTerrainIndex: vi.fn((type: string) => {
            if (type === 'Tunnel') return 5
            if (type === 'Impassable') return 255
            return 0
          }),
        },
      },
    },
  }

  return { worldStub, centerOfCellCalls }
}

function createTunnelInfo(params: {
  location?: CPos
  height?: number
  dimensions?: CVec
  footprint?: string
  terrainType?: string
} = {}): TerrainTunnelInfo {
  return new TerrainTunnelInfo({
    location: params.location ?? new CPos(5, 10),
    height: params.height ?? 3,
    dimensions: params.dimensions ?? new CVec(3, 3),
    footprint: params.footprint ?? '___\n_o_\n___',
    terrainType: params.terrainType ?? 'Tunnel',
  })
}

// ---------------------------------------------------------------------------
// TerrainTunnelLayerInfo
// ---------------------------------------------------------------------------

describe('TerrainTunnelLayerInfo', () => {
  it('has default impassableTerrainType "Impassable"', () => {
    const info = new TerrainTunnelLayerInfo()
    expect(info.impassableTerrainType).toBe('Impassable')
  })

  it('accepts custom impassableTerrainType', () => {
    const info = new TerrainTunnelLayerInfo('Water')
    expect(info.impassableTerrainType).toBe('Water')
  })
})

// ---------------------------------------------------------------------------
// TerrainTunnelLayer
// ---------------------------------------------------------------------------

describe('TerrainTunnelLayer', () => {
  describe('construction and properties', () => {
    it('exposes Index as CustomMovementLayerType.Tunnel', () => {
      const layer = new TerrainTunnelLayer(new TerrainTunnelLayerInfo())
      expect(layer.Index).toBe(CustomMovementLayerType.Tunnel)
    })

    it('reports InteractsWithDefaultLayer as false', () => {
      const layer = new TerrainTunnelLayer(new TerrainTunnelLayerInfo())
      expect(layer.InteractsWithDefaultLayer).toBe(false)
    })

    it('reports ReturnToGroundLayerOnIdle as true', () => {
      const layer = new TerrainTunnelLayer(new TerrainTunnelLayerInfo())
      expect(layer.ReturnToGroundLayerOnIdle).toBe(true)
    })

    it('starts disabled', () => {
      const layer = new TerrainTunnelLayer(new TerrainTunnelLayerInfo())
      expect(layer.enabled).toBe(false)
    })
  })

  describe('enabledForLocomotor', () => {
    it('returns false when no tunnels loaded', () => {
      const layer = new TerrainTunnelLayer(new TerrainTunnelLayerInfo())
      expect(layer.enabledForLocomotor({ Name: 'ground' } as LocomotorInfo)).toBe(false)
    })

    it('returns true after worldLoaded with tunnels', () => {
      const layer = new TerrainTunnelLayer(new TerrainTunnelLayerInfo())
      const { worldStub } = createMockWorld([createTunnelInfo()])
      layer.worldLoaded(
        worldStub as unknown as Parameters<TerrainTunnelLayer['worldLoaded']>[0],
        {} as Parameters<TerrainTunnelLayer['worldLoaded']>[1],
      )
      expect(layer.enabledForLocomotor({ Name: 'ground' } as LocomotorInfo)).toBe(true)
    })
  })

  describe('entryMovementCost / exitMovementCost', () => {
    it('returns MovementCostForUnreachableCell before worldLoaded', () => {
      const layer = new TerrainTunnelLayer(new TerrainTunnelLayerInfo())
      const cell = new CPos(5, 11)
      const locomotorInfo = { Name: 'default' } as LocomotorInfo
      expect(layer.entryMovementCost(locomotorInfo, cell)).toBe(PathGraph.MovementCostForUnreachableCell)
      expect(layer.exitMovementCost(locomotorInfo, cell)).toBe(PathGraph.MovementCostForUnreachableCell)
    })

    it('returns 0 for portal cells after worldLoaded', () => {
      const layer = new TerrainTunnelLayer(new TerrainTunnelLayerInfo())

      // Create a tunnel with a known portal at offset (1,0) from (5,10)
      const tunnelWithPortal = createTunnelInfo({
        footprint: '_o_\n___\n___',
        location: new CPos(5, 10),
      })
      const { worldStub } = createMockWorld([tunnelWithPortal])
      layer.worldLoaded(
        worldStub as unknown as Parameters<TerrainTunnelLayer['worldLoaded']>[0],
        {} as Parameters<TerrainTunnelLayer['worldLoaded']>[1],
      )

      const locomotorInfo = { Name: 'default' } as LocomotorInfo

      // Portal should be at (6,10) on layer 0 and Tunnel layer
      const portalLayer0 = new CPos(6, 10, 0)
      const portalLayerTunnel = new CPos(6, 10, CustomMovementLayerType.Tunnel)

      expect(layer.entryMovementCost(locomotorInfo, portalLayer0)).toBe(0)
      expect(layer.entryMovementCost(locomotorInfo, portalLayerTunnel)).toBe(0)
    })

    it('returns MovementCostForUnreachableCell for non-portal cells', () => {
      const layer = new TerrainTunnelLayer(new TerrainTunnelLayerInfo())
      const tunnelWithPortal = createTunnelInfo({
        footprint: '_o_\n___\n___',
        location: new CPos(5, 10),
      })
      const { worldStub } = createMockWorld([tunnelWithPortal])
      layer.worldLoaded(
        worldStub as unknown as Parameters<TerrainTunnelLayer['worldLoaded']>[0],
        {} as Parameters<TerrainTunnelLayer['worldLoaded']>[1],
      )

      const locomotorInfo = { Name: 'default' } as LocomotorInfo
      // Non-portal cell at (5,10) (the _ at relative 0,0)
      const nonPortal = new CPos(5, 10, 0)
      expect(layer.entryMovementCost(locomotorInfo, nonPortal)).toBe(PathGraph.MovementCostForUnreachableCell)
    })
  })

  describe('centerOfCell', () => {
    it('returns WPos.Zero for unmapped cells', () => {
      const layer = new TerrainTunnelLayer(new TerrainTunnelLayerInfo())
      const result = layer.centerOfCell(new CPos(999, 999))
      expect(result.X).toBe(0)
      expect(result.Y).toBe(0)
      expect(result.Z).toBe(0)
    })

    it('returns underground position for tunnel cells', () => {
      const layer = new TerrainTunnelLayer(new TerrainTunnelLayerInfo())
      const tunnelInfo = createTunnelInfo({
        footprint: '___\n___\n___',
        height: 3,
        location: new CPos(5, 10),
      })
      const { worldStub } = createMockWorld([tunnelInfo])

      layer.worldLoaded(
        worldStub as unknown as Parameters<TerrainTunnelLayer['worldLoaded']>[0],
        {} as Parameters<TerrainTunnelLayer['worldLoaded']>[1],
      )

      // Cell at (5,10): centerOfCell returns (5*1024, 10*1024, 0)
      // height offset = 512 * 3 = 1536
      // underground Z = 0 - 1536 = -1536
      const cell = new CPos(5, 10)
      const center = layer.centerOfCell(cell)
      expect(center.X).toBe(5 * 1024)
      expect(center.Y).toBe(10 * 1024)
      expect(center.Z).toBe(-(512 * 3))
    })
  })

  describe('getTerrainIndex', () => {
    it('returns terrain index for mapped cells', () => {
      const layer = new TerrainTunnelLayer(new TerrainTunnelLayerInfo())
      const tunnelInfo = createTunnelInfo({
        footprint: '_',
        location: new CPos(0, 0),
        dimensions: new CVec(1, 1),
        terrainType: 'Tunnel',
      })
      const { worldStub } = createMockWorld([tunnelInfo])

      layer.worldLoaded(
        worldStub as unknown as Parameters<TerrainTunnelLayer['worldLoaded']>[0],
        {} as Parameters<TerrainTunnelLayer['worldLoaded']>[1],
      )

      const cell = new CPos(0, 0)
      expect(layer.getTerrainIndex(cell)).toBe(5)
    })

    it('returns 255 for unmapped cells', () => {
      const layer = new TerrainTunnelLayer(new TerrainTunnelLayerInfo())
      expect(layer.getTerrainIndex(new CPos(123, 456))).toBe(255)
    })
  })

  describe('worldLoaded integration', () => {
    it('handles world with no tunnel infos gracefully', () => {
      const layer = new TerrainTunnelLayer(new TerrainTunnelLayerInfo())
      const { worldStub } = createMockWorld([])
      expect(() => {
        layer.worldLoaded(
          worldStub as unknown as Parameters<TerrainTunnelLayer['worldLoaded']>[0],
          {} as Parameters<TerrainTunnelLayer['worldLoaded']>[1],
        )
      }).not.toThrow()
      expect(layer.enabled).toBe(false)
    })

    it('handles world with missing map gracefully', () => {
      const layer = new TerrainTunnelLayer(new TerrainTunnelLayerInfo())
      const stub = { actors: [] }
      expect(() => {
        layer.worldLoaded(
          stub as unknown as Parameters<TerrainTunnelLayer['worldLoaded']>[0],
          {} as Parameters<TerrainTunnelLayer['worldLoaded']>[1],
        )
      }).not.toThrow()
      expect(layer.enabled).toBe(false)
    })

    it('enables layer after worldLoaded with tunnels', () => {
      const layer = new TerrainTunnelLayer(new TerrainTunnelLayerInfo())
      const { worldStub } = createMockWorld([createTunnelInfo()])
      layer.worldLoaded(
        worldStub as unknown as Parameters<TerrainTunnelLayer['worldLoaded']>[0],
        {} as Parameters<TerrainTunnelLayer['worldLoaded']>[1],
      )
      expect(layer.enabled).toBe(true)
    })

    it('populates cell centers for all tunnel cells', () => {
      const layer = new TerrainTunnelLayer(new TerrainTunnelLayerInfo())
      const tunnelInfo = createTunnelInfo({
        footprint: '__\n__',
        dimensions: new CVec(2, 2),
        location: new CPos(0, 0),
      })
      const { worldStub } = createMockWorld([tunnelInfo])
      layer.worldLoaded(
        worldStub as unknown as Parameters<TerrainTunnelLayer['worldLoaded']>[0],
        {} as Parameters<TerrainTunnelLayer['worldLoaded']>[1],
      )

      expect(layer.cellCenters.size).toBe(4)
      for (let x = 0; x < 2; x++) {
        for (let y = 0; y < 2; y++) {
          const cell = new CPos(x, y)
          expect(layer.cellCenters.has(cell.Bits)).toBe(true)
        }
      }
    })

    it('populates portal set with both layer copies', () => {
      const layer = new TerrainTunnelLayer(new TerrainTunnelLayerInfo())
      const tunnelInfo = createTunnelInfo({
        footprint: 'o\n_',
        dimensions: new CVec(1, 2),
        location: new CPos(10, 20),
      })
      const { worldStub } = createMockWorld([tunnelInfo])
      layer.worldLoaded(
        worldStub as unknown as Parameters<TerrainTunnelLayer['worldLoaded']>[0],
        {} as Parameters<TerrainTunnelLayer['worldLoaded']>[1],
      )

      expect(layer.portals.size).toBe(2)
      expect(layer.portals.has(new CPos(10, 20, 0).Bits)).toBe(true)
      expect(layer.portals.has(new CPos(10, 20, CustomMovementLayerType.Tunnel).Bits)).toBe(true)
    })

    it('handles multiple tunnel infos', () => {
      const layer = new TerrainTunnelLayer(new TerrainTunnelLayerInfo())
      const tunnel1 = createTunnelInfo({
        footprint: '_',
        dimensions: new CVec(1, 1),
        location: new CPos(0, 0),
      })
      const tunnel2 = createTunnelInfo({
        footprint: '_',
        dimensions: new CVec(1, 1),
        location: new CPos(5, 5),
      })
      const { worldStub } = createMockWorld([tunnel1, tunnel2])
      layer.worldLoaded(
        worldStub as unknown as Parameters<TerrainTunnelLayer['worldLoaded']>[0],
        {} as Parameters<TerrainTunnelLayer['worldLoaded']>[1],
      )

      expect(layer.cellCenters.size).toBe(2)
      expect(layer.cellCenters.has(new CPos(0, 0).Bits)).toBe(true)
      expect(layer.cellCenters.has(new CPos(5, 5).Bits)).toBe(true)
    })
  })
})
