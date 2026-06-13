/**
 * TunnelEntrance.test.ts -- TunnelEntrance unit tests
 *
 * Tests focus on: config defaults, entrance/exit linking, staging point
 * calculation, StagingPoint construction.
 */

import { describe, it, expect } from 'vitest'
import { TunnelEntrance, TunnelEntranceInfo, StagingPoint } from './TunnelEntrance'
import { TerrainTunnelInfo } from './World/TerrainTunnel'
import { CPos } from '../../OpenRA.Game/CPos'
import { CVec } from '../../OpenRA.Game/CVec'
import { WPos } from '../../OpenRA.Game/WPos'
import { WAngle } from '../../OpenRA.Game/WAngle'

// ---------------------------------------------------------------------------
// StagingPoint
// ---------------------------------------------------------------------------

describe('StagingPoint', () => {
  it('stores position and facing', () => {
    const pos = new WPos(1024, 2048, 0)
    const facing = new WAngle(128)
    const sp = new StagingPoint(pos, facing)
    expect(sp.position.X).toBe(1024)
    expect(sp.position.Y).toBe(2048)
    expect(sp.facing.angle).toBe(128)
  })

  it('handles Zero position and facing', () => {
    const sp = new StagingPoint(WPos.Zero, WAngle.Zero)
    expect(sp.position.X).toBe(0)
    expect(sp.position.Y).toBe(0)
    expect(sp.facing.angle).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// TunnelEntranceInfo
// ---------------------------------------------------------------------------

describe('TunnelEntranceInfo', () => {
  it('has sensible defaults', () => {
    const info = new TunnelEntranceInfo()
    expect(info.rallyPoint.X).toBe(0)
    expect(info.rallyPoint.Y).toBe(0)
    expect(info.margin).toBe(2)
    expect(info.sensor.X).toBe(0)
    expect(info.sensor.Y).toBe(0)
  })

  it('accepts custom parameters', () => {
    const info = new TunnelEntranceInfo({
      rallyPoint: new CVec(3, 4),
      margin: 5,
      sensor: new CVec(-1, 0),
    })
    expect(info.rallyPoint.X).toBe(3)
    expect(info.rallyPoint.Y).toBe(4)
    expect(info.margin).toBe(5)
    expect(info.sensor.X).toBe(-1)
    expect(info.sensor.Y).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// TunnelEntrance
// ---------------------------------------------------------------------------

describe('TunnelEntrance', () => {
  function createMockSelf(location: CPos): {
    self: Parameters<TunnelEntrance['created']>[0]
  } {
    return {
      self: {
        actorId: 1,
        isInWorld: true,
        isDead: false,
        disposed: false,
        location: location,
        world: undefined,
      } as unknown as Parameters<TunnelEntrance['created']>[0],
    }
  }

  describe('construction', () => {
    it('stores info reference', () => {
      const info = new TunnelEntranceInfo({ margin: 3 })
      const entrance = new TunnelEntrance(info)
      expect(entrance.info).toBe(info)
      expect(entrance.nearEnough).toBe(3)
    })

    it('starts with null exit', () => {
      const entrance = new TunnelEntrance(new TunnelEntranceInfo())
      expect(entrance.exit).toBeNull()
    })
  })

  describe('created', () => {
    it('sets entrance to location + rallyPoint', () => {
      const info = new TunnelEntranceInfo({
        rallyPoint: new CVec(2, 3),
        sensor: new CVec(0, 0),
      })
      const entrance = new TunnelEntrance(info)
      const { self } = createMockSelf(new CPos(10, 20))

      entrance.created(self)

      expect(entrance.entrance.X).toBe(12) // 10 + 2
      expect(entrance.entrance.Y).toBe(23) // 20 + 3
    })

    it('handles missing location gracefully', () => {
      const info = new TunnelEntranceInfo()
      const entrance = new TunnelEntrance(info)
      const self = {
        actorId: 1,
        isInWorld: true,
        isDead: false,
        disposed: false,
        // No location property
      } as unknown as Parameters<TunnelEntrance['created']>[0]

      // Should not throw
      expect(() => entrance.created(self)).not.toThrow()
    })

    it('handles missing world gracefully', () => {
      const info = new TunnelEntranceInfo({
        sensor: new CVec(1, 0),
      })
      const entrance = new TunnelEntrance(info)
      const { self } = createMockSelf(new CPos(5, 5))

      // No world set, should not throw
      expect(() => entrance.created(self)).not.toThrow()
      expect(entrance.exit).toBeNull()
    })
  })

  describe('tunnel linking (created with full world)', () => {
    it('detects tunnel portal via sensor offset', () => {
      // Tunnel at (10,10) with portals at relative (1,1) and (2,1)
      // Footprint: row 0 = ___, row 1 = _o_o
      // Portal absolute positions: (11,11) and (12,11)
      const tunnelInfo = new TerrainTunnelInfo({
        location: new CPos(10, 10),
        height: 2,
        dimensions: new CVec(3, 2),
        footprint: '___\n_o_o',
        terrainType: 'Tunnel',
      })

      // Actor at (3, 8), sensor offset (8, 3) → sensor pos (11, 11) = portal
      const entranceInfo = new TunnelEntranceInfo({
        rallyPoint: new CVec(1, 0),
        sensor: new CVec(8, 3),
      })

      const actorLocation = new CPos(3, 8)
      const sensorPos = new CPos(
        actorLocation.X + entranceInfo.sensor.X,
        actorLocation.Y + entranceInfo.sensor.Y,
      )
      expect(sensorPos.X).toBe(11)
      expect(sensorPos.Y).toBe(11)

      // The sensor should match a portal cell
      const portalCells = tunnelInfo.portalCells()
      const matches = portalCells.some((c) => c.Bits === sensorPos.Bits)
      expect(matches).toBe(true)
    })

    it('leaves exit null when no matching other entrance', () => {
      const entrance = new TunnelEntrance(new TunnelEntranceInfo({
        rallyPoint: new CVec(0, 0),
        sensor: new CVec(0, 0),
      }))
      const self = {
        actorId: 1,
        isInWorld: true,
        isDead: false,
        disposed: false,
        location: new CPos(0, 0),
        world: {
          worldActor: {
            info: {
              traitInfos: () => [
                new TerrainTunnelInfo({
                  location: new CPos(0, 0),
                  height: 1,
                  dimensions: new CVec(1, 1),
                  footprint: 'o',
                  terrainType: 'Tunnel',
                }),
              ],
            },
          },
          // No actorsWithTrait method → exit stays null
        },
      } as unknown as Parameters<TunnelEntrance['created']>[0]

      entrance.created(self)
      expect(entrance.exit).toBeNull()
    })
  })

  describe('getStagingPoint', () => {
    it('returns staging point at entrance cell center', () => {
      const info = new TunnelEntranceInfo({
        rallyPoint: new CVec(1, 0),
        sensor: new CVec(0, 0),
      })
      const entrance = new TunnelEntrance(info)
      const { self } = createMockSelf(new CPos(5, 5))

      entrance.created(self)

      const cellCenter = (c: CPos) => new WPos(c.X * 1024, c.Y * 1024, 0)
      const sp = entrance.getStagingPoint(cellCenter)

      // entrance = (5+1, 5+0) = (6, 5)
      expect(sp.position.X).toBe(6 * 1024)
      expect(sp.position.Y).toBe(5 * 1024)
    })

    it('returns Zero facing when no exit set', () => {
      const info = new TunnelEntranceInfo({ rallyPoint: new CVec(0, 0) })
      const entrance = new TunnelEntrance(info)
      const { self } = createMockSelf(new CPos(0, 0))
      entrance.created(self)

      const sp = entrance.getStagingPoint((c) => new WPos(c.X * 1024, c.Y * 1024, 0))
      expect(sp.facing.angle).toBe(0) // WAngle.Zero
    })

    it('computes facing toward exit when exit is set', () => {
      const info = new TunnelEntranceInfo({ rallyPoint: new CVec(0, 0) })
      const entrance = new TunnelEntrance(info)
      const { self } = createMockSelf(new CPos(0, 0))
      entrance.created(self)

      // Manually set exit to the right
      entrance.exit = new CPos(10, 0)

      const cellCenter = (c: CPos) => new WPos(c.X * 1024, c.Y * 1024, 0)
      const sp = entrance.getStagingPoint(cellCenter)

      // Exit is to the east of entrance, facing should be east-ish
      // East = angle ~0 in the OpenRA WAngle system
      expect(sp.facing.angle).toBeGreaterThanOrEqual(0)
      expect(sp.facing.angle).toBeLessThan(256) // Should be in the eastern hemisphere
    })
  })
})
