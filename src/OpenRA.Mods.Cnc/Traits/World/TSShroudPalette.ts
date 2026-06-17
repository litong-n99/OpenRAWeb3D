/**
 * TSShroudPalette.ts — 泰伯利亚之日战争迷雾色板
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/World/TSShroudPalette.cs (52 lines)
 *
 * 核心范式转换:
 * - C# ILoadsPalettes → TypeScript ILoadsPalettes interface
 * - C# ImmutablePalette with Enumerable.Range → TypeScript Uint32Array
 * - C# static uint MakeColor(int) → TypeScript function returning RGBA number
 * - C# int2.Lerp(255, 0, i, 127) → TypeScript manual lerp
 *
 * Adds a hard-coded shroud palette to the game. The palette is fully
 * opaque for indices 0-127 (black → transparent gradient) and fully
 * transparent for indices 128-255.
 */

import type { ITraitInfo, IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helper: MakeColor — compute shroud palette color for a given index
// ---------------------------------------------------------------------------

/** Compute the shroud palette color for the given index.
 *
 * OpenRA 对照: static uint MakeColor(int i)
 *
 * Indices 0-127: alpha lerps from 255 to 0 (black with decreasing opacity).
 * Indices 128+: fully transparent (0).
 *
 * The alpha component is stored in the high byte (ARGB layout):
 *   ARGB = (alpha << 24) | (red << 16) | (green << 8) | blue
 *
 * @param i — palette index (0-255)
 * @returns ARGB color value
 */
function makeColor(i: number): number {
  if (i < 128) {
    // int2.Lerp(255, 0, i, 127) → linear interpolation
    const alpha = Math.round(255 - (i / 127) * 255)
    return (alpha << 24) >>> 0
  }
  return 0
}

// ---------------------------------------------------------------------------
// Palette size constant
// ---------------------------------------------------------------------------

const PALETTE_SIZE = 256

// ---------------------------------------------------------------------------
// TSShroudPaletteInfo
// OpenRA 对照: TSShroudPaletteInfo : TraitInfo
// ---------------------------------------------------------------------------

/** Configuration for the TS shroud palette.
 *
 * OpenRA 对照: TSShroudPaletteInfo
 *
 * @traitLocation World | EditorWorld
 */
export class TSShroudPaletteInfo implements ITraitInfo {
  /** Internal palette name.
   *
   * OpenRA 对照: TSShroudPaletteInfo.Name
   */
  readonly name: string

  constructor(params?: { name?: string }) {
    this.name = params?.name ?? 'shroud'
  }

  create(_init: IGameActor): TSShroudPalette {
    return new TSShroudPalette(this)
  }
}

// ---------------------------------------------------------------------------
// TSShroudPalette
// OpenRA 对照: TSShroudPalette : ILoadsPalettes, IProvidesAssetBrowserPalettes
// ---------------------------------------------------------------------------

/** Hard-coded shroud palette for Tiberian Sun.
 *
 * OpenRA 对照: TSShroudPalette
 *
 * Generates a 256-color palette where indices 0-127 have decreasing opacity
 * (used for shroud fade-out) and indices 128+ are fully transparent.
 */
export class TSShroudPalette {
  readonly info: TSShroudPaletteInfo

  constructor(info: TSShroudPaletteInfo) {
    this.info = info
  }

  /** Load the shroud palette into the world renderer.
   *
   * OpenRA 对照: TSShroudPalette.LoadPalettes(WorldRenderer)
   *
   * Creates an ImmutablePalette with 256 entries where each entry
   * ARGB value is computed by makeColor(i).
   *
   * @param _wr — world renderer (passed for compatibility, actual palette add stubbed)
   */
  loadPalettes(_wr: unknown): void {
    // NOTE: In OpenRA, this calls wr.AddPalette(info.Name, new ImmutablePalette(...))
    // The palette data is computed lazily and can be retrieved via getPaletteData()
    // for the actual rendering system to use.
  }

  /** Get the raw palette data as a Uint32Array of ARGB values.
   *
   * OpenRA 对照: ImmutablePalette created in LoadPalettes()
   *
   * @returns Uint32Array of 256 ARGB color values
   */
  getPaletteData(): Uint32Array {
    const palette = new Uint32Array(PALETTE_SIZE)
    for (let i = 0; i < PALETTE_SIZE; i++) {
      palette[i] = makeColor(i)
    }
    return palette
  }

  /** Palette names exposed for asset browser integration.
   *
   * OpenRA 对照: IProvidesAssetBrowserPalettes.PaletteNames
   */
  get paletteNames(): string[] {
    return [this.info.name]
  }
}
