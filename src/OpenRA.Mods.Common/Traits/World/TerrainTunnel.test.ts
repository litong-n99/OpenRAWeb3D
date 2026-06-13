/**
 * TerrainTunnel.test.ts -- TerrainTunnel footprint configuration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: footprint parsing, cell enumeration, state management.
 */

import { describe, it, expect } from 'vitest'
import { TerrainTunnelInfo, TerrainTunnel } from './TerrainTunnel'
import { CPos } from '../../../OpenRA.Game/CPos'
import { CVec } from '../../../OpenRA.Game/CVec'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TerrainTunnelInfo', () => {
  // Helper to create a simple 3x3 tunnel footprint
  function createBasicTunnel(
    footprint: string = '___\n_o_\n___',
    location: CPos = new CPos(5, 10),
  ): TerrainTunnelInfo {
    return new TerrainTunnelInfo({
      location,
      height: 3,
      dimensions: new CVec(3, 3),
      footprint,
      terrainType: 'Tunnel',
    })
  }

  describe('construction', () => {
    it('stores all config parameters', () => {
      const info = createBasicTunnel()
      expect(info.location.X).toBe(5)
      expect(info.location.Y).toBe(10)
      expect(info.height).toBe(3)
      expect(info.dimensions.X).toBe(3)
      expect(info.dimensions.Y).toBe(3)
      expect(info.terrainType).toBe('Tunnel')
    })

    it('handles zero-location', () => {
      const info = new TerrainTunnelInfo({
        location: CPos.Zero,
        height: 0,
        dimensions: new CVec(1, 1),
        footprint: '_',
        terrainType: 'Cave',
      })
      expect(info.location.X).toBe(0)
      expect(info.location.Y).toBe(0)
      expect(info.height).toBe(0)
    })

    it('handles large footprint', () => {
      const info = new TerrainTunnelInfo({
        location: new CPos(0, 0),
        height: 5,
        dimensions: new CVec(5, 5),
        footprint: '_____\n_____\n__o__\n_____\n_____',
        terrainType: 'Tunnel',
      })
      expect(info.dimensions.X).toBe(5)
      expect(info.dimensions.Y).toBe(5)
    })
  })

  describe('tunnelCells', () => {
    it('returns all _ and o cells', () => {
      const info = createBasicTunnel('___\n_o_\n___')
      const cells = info.tunnelCells()
      // 3x3 grid: 9 cells, all _ or o = 9 cells
      expect(cells.length).toBe(9)
    })

    it('excludes x (blocked) cells', () => {
      const info = createBasicTunnel('_x_\n_o_\n_x_')
      const cells = info.tunnelCells()
      // _ x _  (indices 0,1,2)
      // _ o _  (indices 3,4,5)
      // _ x _  (indices 6,7,8)
      // After whitespace filter: _x__o__x_ = 9 chars
      // _: 0,2,3,5,6,8 → 6 underscores
      // o: 4 → 1 portal
      // x: 1,7 → 2 blocked (note: location index 7 NOT 'x')
      // Actually: index 7 is the last char before the last _
      // Re-counting: _ x _ \n _ o _ \n _ x _
      // Filtered: _ x _ _ o _ _ x _
      // 0:_, 1:x, 2:_, 3:_, 4:o, 5:_, 6:_, 7:x, 8:_
      // tunnel cells (_,o): 0,2,3,4,5,6,8 = 7
      expect(cells.length).toBe(7)
    })

    it('offsets cells by location', () => {
      const info = createBasicTunnel('___\n_o_\n___', new CPos(10, 20))
      const cells = info.tunnelCells()
      // All cells should be within [10, 20] + [0..2, 0..2]
      for (const c of cells) {
        expect(c.X).toBeGreaterThanOrEqual(10)
        expect(c.X).toBeLessThanOrEqual(12)
        expect(c.Y).toBeGreaterThanOrEqual(20)
        expect(c.Y).toBeLessThanOrEqual(22)
      }
    })

    it('includes portal cells in tunnel cells', () => {
      const info = createBasicTunnel('_o_\n___\n___')
      const tunnelCells = info.tunnelCells()
      const portalCells = info.portalCells()
      const portalBits = new Set(portalCells.map((c) => c.Bits))
      for (const tc of tunnelCells) {
        // Every portal cell must be in tunnel cells
        if (portalBits.has(tc.Bits)) continue
      }
      // All portal cells in tunnel cells
      for (const pc of portalCells) {
        expect(tunnelCells.some((tc) => tc.Bits === pc.Bits)).toBe(true)
      }
    })
  })

  describe('portalCells', () => {
    it('returns only o cells', () => {
      const info = createBasicTunnel('xox\n___\n_o_')
      const portals = info.portalCells()
      // x o x  (indices 0,1,2) - 'o' at index 1
      // _ _ _  (indices 3,4,5)
      // _ o _  (indices 6,7,8) - 'o' at index 7
      expect(portals.length).toBe(2)
      // First portal at relative (1,0) → absolute (location.X + 1, location.Y + 0)
      expect(portals[0].X).toBe(info.location.X + 1)
      expect(portals[0].Y).toBe(info.location.Y + 0)
      // Second portal at relative (1,2) → absolute (location.X + 1, location.Y + 2)
      expect(portals[1].X).toBe(info.location.X + 1)
      expect(portals[1].Y).toBe(info.location.Y + 2)
    })

    it('returns empty when no o cells', () => {
      const info = createBasicTunnel('___\n___\n___')
      const portals = info.portalCells()
      expect(portals.length).toBe(0)
    })

    it('does not include _ cells as portals', () => {
      const info = createBasicTunnel('_o_\n___\n_x_')
      const portals = info.portalCells()
      for (const p of portals) {
        expect(info.footprint.split('').filter((c) => !/\s/.test(c))[
          (p.Y - info.location.Y) * info.dimensions.X + (p.X - info.location.X)
        ]).toBe('o')
      }
      // 9 cells, only 1 portal
      expect(portals.length).toBe(1)
    })
  })

  describe('footprint parsing edge cases', () => {
    it('handles whitespace in footprint string', () => {
      const info = new TerrainTunnelInfo({
        location: CPos.Zero,
        height: 1,
        dimensions: new CVec(2, 2),
        footprint: '  _ o\n x _ ',
        terrainType: 'Tunnel',
      })
      // Whitespace stripped: _ o x _ (4 characters)
      const tunnelCells = info.tunnelCells()
      // _ at (0,0), o at (1,0), x blocked, _ at (1,1)
      expect(tunnelCells.length).toBe(3) // _ _, o
    })

    it('handles single-cell tunnel', () => {
      const info = new TerrainTunnelInfo({
        location: new CPos(0, 0),
        height: 1,
        dimensions: new CVec(1, 1),
        footprint: 'o',
        terrainType: 'Tunnel',
      })
      expect(info.tunnelCells().length).toBe(1)
      expect(info.portalCells().length).toBe(1)
      expect(info.tunnelCells()[0].X).toBe(0)
      expect(info.tunnelCells()[0].Y).toBe(0)
    })

    it('handles horizontal strip tunnel', () => {
      const info = new TerrainTunnelInfo({
        location: new CPos(3, 7),
        height: 2,
        dimensions: new CVec(5, 1),
        footprint: 'oo__x',
        terrainType: 'Tunnel',
      })
      expect(info.dimensions.X).toBe(5)
      expect(info.dimensions.Y).toBe(1)
      const portals = info.portalCells()
      expect(portals.length).toBe(2)
      expect(info.tunnelCells().length).toBe(4) // oo_x: o, o, _, _
    })
  })
})

describe('TerrainTunnel', () => {
  it('wraps TerrainTunnelInfo correctly', () => {
    const info = new TerrainTunnelInfo({
      location: new CPos(0, 0),
      height: 1,
      dimensions: new CVec(1, 1),
      footprint: '_',
      terrainType: 'Tunnel',
    })
    const tunnel = new TerrainTunnel(info)
    expect(tunnel.info).toBe(info)
  })

  it('multiple instances share the same info reference', () => {
    const info = new TerrainTunnelInfo({
      location: CPos.Zero,
      height: 2,
      dimensions: new CVec(2, 2),
      footprint: 'oooo',
      terrainType: 'Cave',
    })
    const t1 = new TerrainTunnel(info)
    const t2 = new TerrainTunnel(info)
    expect(t1.info).toBe(t2.info)
  })
})
