/**
 * D2kResourceRenderer.ts — D2K 香料资源渲染器 (带圆角/平滑边框)
 * OpenRA 对照: OpenRA.Mods.D2k/Traits/World/D2kResourceRenderer.cs (170 lines)
 *
 * 核心范式转换:
 * - C# D2kResourceRendererInfo : ResourceRendererInfo → TS extends ResourceRendererInfo
 * - C# D2kResourceRenderer : ResourceRenderer → TS extends ResourceRenderer
 * - C# [Flags] enum ClearSides : byte → TS const object with bit flags
 * - C# FrozenDictionary<ClearSides, int> SpriteMap → TS Map<number, number>
 * - C# FindClearSides uses CVec.Directions → TS inline neighbour checks
 * - C# override UpdateRenderedSprite → TS override method preserves round-border logic
 * - 3D: TerrainSpriteLayer with spice variant sprite UV selection.
 *   Different visual for low-density vs high-density spice.
 */

import { CPos } from '../../../OpenRA.Game/CPos'
import { CVec } from '../../../OpenRA.Game/CVec'
import {
  ResourceRenderer,
  ResourceRendererInfo,
  type RendererCellContents,
  type IResourceRendererWorld,
  RendererCellContentsEmpty,
} from '../../../OpenRA.Mods.Common/Traits/World/ResourceRenderer'

// ---------------------------------------------------------------------------
// ClearSides — bit flags for which adjacent cells don't have the resource
// OpenRA 对照: D2kResourceRenderer.ClearSides (Flags enum, byte)
// ---------------------------------------------------------------------------

/** Bit flags indicating which sides of a cell are "clear" (no resource).
 *
 * OpenRA 对照: D2kResourceRenderer.ClearSides (byte enum with Flags)
 *
 * Used to determine which sprite variant to use for rounded resource edges.
 */
export const ClearSides = {
  None: 0x00,
  Left: 0x01,
  Top: 0x02,
  Right: 0x04,
  Bottom: 0x08,
  TopLeft: 0x10,
  TopRight: 0x20,
  BottomLeft: 0x40,
  BottomRight: 0x80,
  All: 0xFF,
} as const

export type ClearSides = number

// ---------------------------------------------------------------------------
// SpriteMap — maps ClearSides combinations to sprite index
// OpenRA 对照: D2kResourceRenderer.SpriteMap (FrozenDictionary<ClearSides, int>)
// ---------------------------------------------------------------------------

/** Mapping from ClearSides combination to sprite atlas index.
 *
 * OpenRA 对照: D2kResourceRenderer.SpriteMap
 *
 * Each key is a bitmask of ClearSides flags. Each value is the sprite
 * index in the resource sprite sheet that represents that border style.
 * This is a byte-for-byte copy of the OpenRA C# dictionary.
 */
function buildSpriteMap(): Map<ClearSides, number> {
  const map = new Map<ClearSides, number>()

  const entries: [ClearSides, number][] = [
    [ClearSides.Left | ClearSides.Top | ClearSides.TopLeft | ClearSides.TopRight | ClearSides.BottomLeft | ClearSides.BottomRight, 2],
    [ClearSides.Top | ClearSides.Right | ClearSides.TopLeft | ClearSides.TopRight | ClearSides.BottomLeft | ClearSides.BottomRight, 3],
    [ClearSides.Left | ClearSides.Bottom | ClearSides.TopLeft | ClearSides.TopRight | ClearSides.BottomLeft | ClearSides.BottomRight, 4],
    [ClearSides.Right | ClearSides.Bottom | ClearSides.TopLeft | ClearSides.TopRight | ClearSides.BottomLeft | ClearSides.BottomRight, 5],
    [ClearSides.Left | ClearSides.TopLeft | ClearSides.TopRight | ClearSides.BottomLeft | ClearSides.BottomRight, 6],
    [ClearSides.Right | ClearSides.TopLeft | ClearSides.TopRight | ClearSides.BottomLeft | ClearSides.BottomRight, 7],
    [ClearSides.Top | ClearSides.TopLeft | ClearSides.TopRight | ClearSides.BottomLeft | ClearSides.BottomRight, 8],
    [ClearSides.Bottom | ClearSides.TopLeft | ClearSides.TopRight | ClearSides.BottomLeft | ClearSides.BottomRight, 9],
    [ClearSides.Left | ClearSides.Top | ClearSides.TopLeft | ClearSides.TopRight | ClearSides.BottomLeft, 10],
    [ClearSides.Top | ClearSides.Right | ClearSides.TopLeft | ClearSides.TopRight | ClearSides.BottomRight, 11],
    [ClearSides.Left | ClearSides.Bottom | ClearSides.TopLeft | ClearSides.BottomLeft | ClearSides.BottomRight, 12],
    [ClearSides.Right | ClearSides.Bottom | ClearSides.TopRight | ClearSides.BottomLeft | ClearSides.BottomRight, 13],
    [ClearSides.Left | ClearSides.Top | ClearSides.Right | ClearSides.TopLeft | ClearSides.TopRight | ClearSides.BottomLeft | ClearSides.BottomRight, 14],
    [ClearSides.Left | ClearSides.Right | ClearSides.Bottom | ClearSides.TopLeft | ClearSides.TopRight | ClearSides.BottomLeft | ClearSides.BottomRight, 15],
    [ClearSides.Left | ClearSides.Top | ClearSides.Bottom | ClearSides.TopLeft | ClearSides.TopRight | ClearSides.BottomLeft | ClearSides.BottomRight, 16],
    [ClearSides.Top | ClearSides.Right | ClearSides.Bottom | ClearSides.TopLeft | ClearSides.TopRight | ClearSides.BottomLeft | ClearSides.BottomRight, 17],
    [ClearSides.Top | ClearSides.TopLeft | ClearSides.TopRight, 18],
    [ClearSides.Right | ClearSides.TopRight | ClearSides.BottomRight, 19],
    [ClearSides.Left | ClearSides.TopLeft | ClearSides.BottomLeft, 20],
    [ClearSides.Bottom | ClearSides.BottomLeft | ClearSides.BottomRight, 21],
    [ClearSides.TopLeft, 22],
    [ClearSides.TopRight, 23],
    [ClearSides.BottomLeft, 24],
    [ClearSides.BottomRight, 25],
    [ClearSides.Left | ClearSides.TopLeft | ClearSides.BottomLeft | ClearSides.BottomRight, 26],
    [ClearSides.Right | ClearSides.TopRight | ClearSides.BottomLeft | ClearSides.BottomRight, 27],
    [ClearSides.Top | ClearSides.TopLeft | ClearSides.TopRight | ClearSides.BottomRight, 28],
    [ClearSides.Top | ClearSides.TopLeft | ClearSides.TopRight | ClearSides.BottomLeft, 29],
    [ClearSides.TopRight | ClearSides.BottomLeft | ClearSides.BottomRight, 30],
    [ClearSides.TopLeft | ClearSides.BottomLeft | ClearSides.BottomRight, 31],
    [ClearSides.TopLeft | ClearSides.TopRight | ClearSides.BottomRight, 32],
    [ClearSides.TopLeft | ClearSides.TopRight | ClearSides.BottomLeft, 33],
    [ClearSides.TopRight | ClearSides.BottomRight, 34],
    [ClearSides.TopLeft | ClearSides.TopRight, 35],
    [ClearSides.TopRight | ClearSides.BottomLeft, 36],
    [ClearSides.TopLeft | ClearSides.BottomLeft, 37],
    [ClearSides.BottomLeft | ClearSides.BottomRight, 38],
    [ClearSides.TopLeft | ClearSides.BottomRight, 39],
    [ClearSides.TopLeft | ClearSides.TopRight | ClearSides.BottomLeft | ClearSides.BottomRight, 40],
    [ClearSides.Left | ClearSides.Right | ClearSides.TopLeft | ClearSides.TopRight | ClearSides.BottomLeft | ClearSides.BottomRight, 41],
    [ClearSides.Top | ClearSides.Bottom | ClearSides.TopLeft | ClearSides.TopRight | ClearSides.BottomLeft | ClearSides.BottomRight, 42],
    [ClearSides.All, 44],
    [ClearSides.Left | ClearSides.TopLeft | ClearSides.TopRight | ClearSides.BottomLeft, 46],
    [ClearSides.Right | ClearSides.TopLeft | ClearSides.TopRight | ClearSides.BottomRight, 47],
    [ClearSides.Bottom | ClearSides.TopRight | ClearSides.BottomLeft | ClearSides.BottomRight, 48],
    [ClearSides.Bottom | ClearSides.TopLeft | ClearSides.BottomLeft | ClearSides.BottomRight, 49],
  ]

  for (const [flag, index] of entries) {
    map.set(flag, index)
  }

  return map
}

// ---------------------------------------------------------------------------
// D2kResourceRendererInfo
// OpenRA 对照: D2kResourceRendererInfo : ResourceRendererInfo
// ---------------------------------------------------------------------------

/** Configuration for the D2K resource renderer.
 *
 * OpenRA 对照: D2kResourceRendererInfo (public class, extends ResourceRendererInfo)
 *
 * Attach to the world actor to render spice with round (non-square) borders.
 * Uses the same ResourceRendererInfo config structure but overrides the
 * rendering logic to produce rounded spice edges.
 */
export class D2kResourceRendererInfo extends ResourceRendererInfo {
  constructor(params: ConstructorParameters<typeof ResourceRendererInfo>[0] = {}) {
    super(params)
  }
}

// ---------------------------------------------------------------------------
// D2kResourceRenderer
// OpenRA 对照: D2kResourceRenderer : ResourceRenderer
// ---------------------------------------------------------------------------

/** Renders D2K spice resources with rounded borders.
 *
 * OpenRA 对照: D2kResourceRenderer (public class, extends ResourceRenderer)
 *
 * Extends the base ResourceRenderer to replace the density-based frame
 * selection with a round-border sprite selection. Each resource cell's
 * sprite is chosen based on which adjacent cells contain the same resource
 * type, producing a smooth, rounded-edge visual for spice patches.
 *
 * When all adjacent cells have the same resource type, the density-based
 * frame selection still applies (half-density vs full-density sprite).
 */
export class D2kResourceRenderer extends ResourceRenderer {
  /** Pre-built sprite map for clear sides → sprite index. */
  private static readonly _spriteMap: Map<ClearSides, number> = buildSpriteMap()

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: D2kResourceRenderer(Actor self, D2kResourceRendererInfo info) : base(self, info)
  // ---------------------------------------------------------------------------

  /** Create a new D2K resource renderer.
   *
   * OpenRA 对照: D2kResourceRenderer(Actor self, D2kResourceRendererInfo info)
   *
   * @param world — the game world
   * @param info — trait configuration
   */
  constructor(world: IResourceRendererWorld, info: D2kResourceRendererInfo) {
    super(world, info)
  }

  // ---------------------------------------------------------------------------
  // FindClearSides
  // OpenRA 对照: D2kResourceRenderer.FindClearSides(CPos, string)
  // ---------------------------------------------------------------------------

  /** Determine which sides of a resource cell are adjacent to non-resource cells.
   *
   * OpenRA 对照: D2kResourceRenderer.FindClearSides(CPos cell, string resourceType)
   *
   * Checks all 8 neighbors (N, S, E, W, NE, NW, SE, SW) for the same
   * resource type. If a neighbor lacks the resource, the corresponding
   * ClearSides flags are set.
   *
   * @param cell — the cell to check
   * @param resourceType — the resource type to look for
   * @returns a bit mask of ClearSides flags
   */
  findClearSides(cell: CPos, resourceType: string): ClearSides {
    let ret: ClearSides = ClearSides.None

    // Top neighbor (Y-1)
    if (!this.cellContains(CPos.add(cell, new CVec(0, -1)), resourceType))
      ret |= ClearSides.Top | ClearSides.TopLeft | ClearSides.TopRight

    // Left neighbor (X-1)
    if (!this.cellContains(CPos.add(cell, new CVec(-1, 0)), resourceType))
      ret |= ClearSides.Left | ClearSides.TopLeft | ClearSides.BottomLeft

    // Right neighbor (X+1)
    if (!this.cellContains(CPos.add(cell, new CVec(1, 0)), resourceType))
      ret |= ClearSides.Right | ClearSides.TopRight | ClearSides.BottomRight

    // Bottom neighbor (Y+1)
    if (!this.cellContains(CPos.add(cell, new CVec(0, 1)), resourceType))
      ret |= ClearSides.Bottom | ClearSides.BottomLeft | ClearSides.BottomRight

    // Top-left neighbor (-1, -1)
    if (!this.cellContains(CPos.add(cell, new CVec(-1, -1)), resourceType))
      ret |= ClearSides.TopLeft

    // Top-right neighbor (1, -1)
    if (!this.cellContains(CPos.add(cell, new CVec(1, -1)), resourceType))
      ret |= ClearSides.TopRight

    // Bottom-left neighbor (-1, 1)
    if (!this.cellContains(CPos.add(cell, new CVec(-1, 1)), resourceType))
      ret |= ClearSides.BottomLeft

    // Bottom-right neighbor (1, 1)
    if (!this.cellContains(CPos.add(cell, new CVec(1, 1)), resourceType))
      ret |= ClearSides.BottomRight

    return ret
  }

  // ---------------------------------------------------------------------------
  // CellContains — check if a cell has the given resource type
  // OpenRA 对照: D2kResourceRenderer.CellContains(CPos, string)
  // ---------------------------------------------------------------------------

  /** Check if a cell contains a specific resource type.
   *
   * OpenRA 对照: D2kResourceRenderer.CellContains(CPos cell, string resourceType)
   *
   * @param cell — the cell to check
   * @param resourceType — the resource type to look for
   * @returns true if the cell has that resource type rendered
   */
  cellContains(cell: CPos, resourceType: string): boolean {
    const contents = this.renderContents.get(cell)
    return contents.type === resourceType
  }

  // ---------------------------------------------------------------------------
  // UpdateRenderedSprite (override)
  // OpenRA 对照: D2kResourceRenderer.UpdateRenderedSprite(CPos, RendererCellContents)
  // ---------------------------------------------------------------------------

  /** Override to use rounded-border sprite selection instead of density-based.
   *
   * OpenRA 对照: D2kResourceRenderer.UpdateRenderedSprite(CPos cell,
   *   RendererCellContents content) [protected override]
   *
   * For each affected cell (the changed cell + its 8 neighbors), computes
   * the ClearSides bit mask and maps it to a sprite index.
   *
   * When a cell is completely surrounded (no clear sides), falls back to
   * density-based frame selection (half-density vs full-density).
   *
   * @param cell — the primary cell that changed
   * @param content — the new render contents for that cell
   */
  updateRenderedSprite(cell: CPos, content: RendererCellContents): void {
    this.updateRenderedSpriteInner(cell, content)

    const directions = CVec.Directions
    for (const dir of directions) {
      const neighbor = CPos.add(cell, dir)
      const neighborContent = this.renderContents.get(neighbor)
      if (neighborContent && neighborContent !== RendererCellContentsEmpty) {
        this.updateRenderedSpriteInner(neighbor, neighborContent)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // UpdateRenderedSpriteInner
  // OpenRA 对照: D2kResourceRenderer.UpdateRenderedSpriteInner(CPos, RendererCellContents)
  // ---------------------------------------------------------------------------

  /** Update a single cell's sprite based on its rounded-border state.
   *
   * OpenRA 对照: D2kResourceRenderer.UpdateRenderedSpriteInner(CPos cell,
   *   RendererCellContents content)
   *
   * Logic:
   * - If density > 0:
   *   - Compute ClearSides bit mask
   *   - If no clear sides (surrounded), use density-based frame
   *     (0 for low, 1 for high density)
   *   - Otherwise, look up the sprite index from SpriteMap
   *   - If no SpriteMap entry, throw (OpenRA throws InvalidOperationException)
   * - If density <= 0, clear the sprite
   *
   * @param cell — the cell to update
   * @param content — the cell's render contents
   */
  private updateRenderedSpriteInner(
    cell: CPos,
    content: RendererCellContents,
  ): void {
    if (content.density > 0) {
      const clear = this.findClearSides(cell, content.type)

      if (clear === ClearSides.None) {
        // Completely surrounded — use density-based frame
        const maxDensity = this.resourceLayer.getMaxDensity(content.type)
        const index = content.density > maxDensity / 2 ? 1 : 0
        this.updateSpriteLayers(cell, content.sequence, index, content.palette)
      } else {
        const spriteIndex = D2kResourceRenderer._spriteMap.get(clear)
        if (spriteIndex !== undefined) {
          this.updateSpriteLayers(
            cell,
            content.sequence,
            spriteIndex,
            content.palette,
          )
        } else {
          throw new Error(
            `SpriteMap does not contain an index for ClearSides type '${clear}'`,
          )
        }
      }
    } else {
      this.updateSpriteLayers(cell, null, 0, null)
    }
  }

  // CVec.Directions is used from the existing CVec import — already defined at
  // src/OpenRA.Game/CVec.ts. No fallback needed.
}
