/**
 * TerrainTunnel.ts -- TerrainTunnel tunnel footprint configuration
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/TerrainTunnel.cs
 *
 * 核心范式转换:
 * - C# TraitInfo<TerrainTunnel> + Requires<TerrainTunnelLayerInfo> →
 *   TypeScript class with explicit dependency documentation
 * - C# yield return IEnumerable<CPos> → TypeScript generator or array return
 * - C# FieldLoader.Require attributes → JSDoc conventions
 * - C# TraitLocation(SystemActors.World) → documented convention
 */

import { CPos } from '../../../OpenRA.Game/CPos'
import { CVec } from '../../../OpenRA.Game/CVec'

// ---------------------------------------------------------------------------
// TerrainTunnelInfo -- Tunnel footprint configuration
// ---------------------------------------------------------------------------

/**
 * Tunnel footprint configuration for a terrain tunnel.
 *
 * OpenRA 对照: TerrainTunnelInfo : TraitInfo<TerrainTunnel>
 *
 * This is a map-level configuration placed during map creation. It defines
 * which cells are underground tunnel passages and which are portals.
 *
 * The Footprint string uses three characters:
 * - '_' = passable tunnel interior cell
 * - 'x' = blocked (non-tunnel) cell
 * - 'o' = portal cell (acts as entrance/exit point)
 *
 * Whitespace in the footprint string is ignored.
 */
export class TerrainTunnelInfo {
  /** Location of the top-left corner of the tunnel footprint.
   *
   * OpenRA 对照: TerrainTunnelInfo.Location
   */
  readonly location: CPos

  /** Height of the tunnel floor in map height steps.
   *
   * OpenRA 对照: TerrainTunnelInfo.Height
   */
  readonly height: number

  /** Size of the tunnel footprint (width × height in cells).
   *
   * OpenRA 对照: TerrainTunnelInfo.Dimensions
   */
  readonly dimensions: CVec

  /** Tunnel footprint string. '_' is passable, 'x' is blocked, 'o' are portals.
   *
   * OpenRA 对照: TerrainTunnelInfo.Footprint
   */
  readonly footprint: string

  /** Terrain type name of the tunnel floor.
   *
   * OpenRA 对照: TerrainTunnelInfo.TerrainType
   */
  readonly terrainType: string

  constructor(params: {
    location: CPos
    height: number
    dimensions: CVec
    footprint: string
    terrainType: string
  }) {
    this.location = params.location
    this.height = params.height
    this.dimensions = params.dimensions
    this.footprint = params.footprint
    this.terrainType = params.terrainType
  }

  // ---------------------------------------------------------------------------
  // Footprint parsing
  // ---------------------------------------------------------------------------

  /**
   * Enumerate all passable tunnel cells (both '_' and 'o' characters).
   *
   * OpenRA 对照: TerrainTunnelInfo.TunnelCells()
   *
   * @returns array of cell positions that are part of the tunnel interior
   */
  tunnelCells(): CPos[] {
    const result: CPos[] = []
    const cells = this.cellsMatching(['_', 'o'])
    for (const c of cells) result.push(c)
    return result
  }

  /**
   * Enumerate only portal cells ('o' characters).
   *
   * OpenRA 对照: TerrainTunnelInfo.PortalCells()
   *
   * @returns array of cell positions that act as tunnel portals
   */
  portalCells(): CPos[] {
    const result: CPos[] = []
    const cells = this.cellsMatching(['o'])
    for (const c of cells) result.push(c)
    return result
  }

  /**
   * Enumerate cells matching specific footprint characters.
   *
   * OpenRA 对照: TerrainTunnelInfo.CellsMatching(char c)
   *
   * The footprint string is scanned linearly (row-major from top-left),
   * skipping whitespace characters. Each non-whitespace character corresponds
   * to one cell in the Dimensions grid.
   *
   * @param matchChars -- characters that indicate a matching cell
   * @returns generator of matching cell positions
   */
  private *cellsMatching(matchChars: string[]): Generator<CPos, void, undefined> {
    const footprint = this.footprint.split('').filter((ch) => !/\s/.test(ch))
    let index = 0
    for (let y = 0; y < this.dimensions.Y; y++) {
      for (let x = 0; x < this.dimensions.X; x++) {
        if (index < footprint.length && matchChars.includes(footprint[index])) {
          yield CPos.add(this.location, new CVec(x, y))
        }
        index++
      }
    }
  }
}

// ---------------------------------------------------------------------------
// TerrainTunnel -- Trait instance (empty marker, like C#)
// ---------------------------------------------------------------------------

/**
 * Trait instance for TerrainTunnel. In OpenRA, this serves as a marker
 * attached to the world actor, used by TerrainTunnelLayer to discover
 * tunnel configurations.
 *
 * OpenRA 对照: TerrainTunnel (empty class, marker for world actor)
 *
 * NOTE: In our TypeScript migration, TraitInfo and Trait are separate
 * concepts. TerrainTunnelInfo holds the configuration. The TerrainTunnel
 * class is a lightweight marker for the world actor's trait dictionary.
 */
export class TerrainTunnel {
  /** The parsed tunnel info that this trait instance represents. */
  readonly info: TerrainTunnelInfo

  constructor(info: TerrainTunnelInfo) {
    this.info = info
  }
}
