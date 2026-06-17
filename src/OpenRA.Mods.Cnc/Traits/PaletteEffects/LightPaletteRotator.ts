/**
 * LightPaletteRotator.ts — 光照色板旋转特效（闪烁动画）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/PaletteEffects/LightPaletteRotator.cs (66 lines)
 *
 * 核心范式转换:
 * - C# IPaletteModifier.AdjustPalette() → TypeScript palette modifier interface
 * - C# MutablePalette.SetColor/GetColor → TypeScript Uint32Array manipulation
 * - C# (int)t % RotationIndices.Length → TypeScript Math.floor(t) % length
 * - C# FrozenSet<string> ExcludePalettes → TypeScript ReadonlySet<string>
 *
 * NOTE: The actual palette rendering integration is deferred to the rendering
 * subsystem. This trait tracks the rotation state and exposes the current
 * color mapping for the renderer to consume.
 */

import type { ITraitInfo, IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// LightPaletteRotatorInfo
// OpenRA 对照: LightPaletteRotatorInfo : TraitInfo
// ---------------------------------------------------------------------------

/** Configuration for the rotating light palette effect.
 *
 * OpenRA 对照: LightPaletteRotatorInfo
 *
 * @traitLocation World | EditorWorld
 */
export class LightPaletteRotatorInfo implements ITraitInfo {
  /** Palettes this effect should not apply to.
   *
   * OpenRA 对照: LightPaletteRotatorInfo.ExcludePalettes
   */
  readonly excludePalettes: ReadonlySet<string>

  /** Speed at which the effect cycles through palette indices.
   *
   * OpenRA 对照: LightPaletteRotatorInfo.TimeStep
   */
  readonly timeStep: number

  /** Palette index to map to rotating color indices.
   *
   * OpenRA 对照: LightPaletteRotatorInfo.ModifyIndex
   */
  readonly modifyIndex: number

  /** Palette indices to rotate through.
   *
   * OpenRA 对照: LightPaletteRotatorInfo.RotationIndices
   */
  readonly rotationIndices: readonly number[]

  constructor(params?: {
    excludePalettes?: ReadonlySet<string>
    timeStep?: number
    modifyIndex?: number
    rotationIndices?: readonly number[]
  }) {
    this.excludePalettes = params?.excludePalettes ?? new Set()
    this.timeStep = params?.timeStep ?? 0.5
    this.modifyIndex = params?.modifyIndex ?? 103
    this.rotationIndices = params?.rotationIndices ?? [
      230, 231, 232, 233, 234, 235, 236, 237, 238, 239,
      238, 237, 236, 235, 234, 233, 232, 231,
    ]
  }

  create(_init: IGameActor): LightPaletteRotator {
    return new LightPaletteRotator(this)
  }
}

// ---------------------------------------------------------------------------
// LightPaletteRotator
// OpenRA 对照: LightPaletteRotator : ITick, IPaletteModifier
// ---------------------------------------------------------------------------

/** Rotating light palette effect used for blinking animations on actors.
 *
 * OpenRA 对照: LightPaletteRotator
 *
 * Cycles through a predefined list of color indices, copying the color from
 * each rotated index to the modify index position. This creates a blinking
 * or pulsing effect on structures like the Advanced Power Plant.
 */
export class LightPaletteRotator {
  readonly info: LightPaletteRotatorInfo

  /** Accumulated time for rotation calculation.
   *
   * OpenRA 对照: LightPaletteRotator.t (float)
   */
  private t: number = 0

  constructor(info: LightPaletteRotatorInfo) {
    this.info = info
  }

  // -------------------------------------------------------------------------
  // ITick
  // -------------------------------------------------------------------------

  /** Advance the rotation timer.
   *
   * OpenRA 对照: ITick.Tick(Actor)
   */
  tick(_self: IGameActor): void {
    this.t += this.info.timeStep
  }

  // -------------------------------------------------------------------------
  // IPaletteModifier
  // -------------------------------------------------------------------------

  /** Apply the palette rotation to all non-excluded palettes.
   *
   * OpenRA 对照: IPaletteModifier.AdjustPalette(IReadOnlyDictionary<string, MutablePalette>)
   *
   * For each palette not in the exclude list, sets the modifyIndex color
   * to the color at the currently rotated index.
   *
   * @param palettes — map of palette name to palette data (Uint32Array)
   */
  adjustPalette(palettes: ReadonlyMap<string, Uint32Array>): void {
    const rotate = Math.floor(this.t) % this.info.rotationIndices.length

    for (const [key, palette] of palettes) {
      if (this.info.excludePalettes.has(key)) {
        continue
      }

      if (palette.length > this.info.modifyIndex) {
        const sourceIndex = this.info.rotationIndices[rotate]
        if (sourceIndex !== undefined && palette.length > sourceIndex) {
          palette[this.info.modifyIndex] = palette[sourceIndex]
        }
      }
    }
  }

  /** Get the current rotation index.
   *
   * OpenRA 对照: (int)t % RotationIndices.Length
   */
  get currentRotationIndex(): number {
    return Math.floor(this.t) % this.info.rotationIndices.length
  }

  /** Get the current accumulated time.
   *
   * OpenRA 对照: LightPaletteRotator.t (private)
   */
  get currentTime(): number {
    return this.t
  }
}
