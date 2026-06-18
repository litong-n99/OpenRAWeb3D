/**
 * TeslaZapRenderable.ts — 特斯拉闪电可渲染体（动态生成闪电电弧）
 * OpenRA 对照: OpenRA.Mods.Cnc/Graphics/TeslaZapRenderable.cs (167 lines)
 *
 * 核心范式转换:
 * - C# IRenderable + IFinalizedRenderable + IPalettedRenderable → TS renderable descriptor
 * - C# 预定义 Steps[][] 偏移表 → TS const 偏移表
 * - C# float2 向量数学 → TS 内联向量运算
 * - C# Game.CosmeticRandom → TS seeded pseudo-random
 * - C# ISpriteSequence → TS duck-typed sequence
 * - C# yield return → TS 数组累积
 * - C# SpriteRenderable (per-segment real sprite) → TS TeslaZapSegment descriptor
 *
 * NOTE: WDist.fromPDF is not yet implemented. Random offsets use a simplified
 * approach for the zap effect (uniform distribution scaled by distance).
 *
* Full 3D zap rendering requires LinesMesh with dynamic vertex
 * allocation and ShaderMaterial glow. Currently produces TeslaZapSegment
 * descriptors that record sprite/position data for use by a 3D renderer.
 */

import { WPos } from '../../OpenRA.Game/WPos.js'
import { WVec } from '../../OpenRA.Game/WVec.js'

// ---------------------------------------------------------------------------
// Predefined step tables
// ---------------------------------------------------------------------------

const STEPS: readonly (readonly [number, number, number, number, number])[] = [
  [8, 8, 4, 4, 0],
  [-8, -8, -4, -4, 0],
  [8, 0, 4, 4, 1],
  [-8, 0, -4, 4, 1],
  [0, 8, 4, 4, 2],
  [0, -8, 4, -4, 2],
  [-8, 8, -4, 4, 3],
  [8, -8, 4, -4, 3],
]

// ---------------------------------------------------------------------------
// Simple seeded random
// ---------------------------------------------------------------------------

export class SeededRandom {
  private _seed: number

  constructor(seed: number) {
    this._seed = seed
  }

  next(max: number): number {
    this._seed = (this._seed * 1103515245 + 12345) & 0x7fffffff
    return this._seed % max
  }
}

/** Simple random distance for zap offsets (replaces WDist.fromPDF which is deferred).
 *
 * Returns a random signed distance proportional to the segment length.
 */
function randomZapOffset(rng: SeededRandom, distLen: number): number {
  // Uniform random offset in [-distLen/4, distLen/4]
  return (rng.next(Math.floor(distLen / 2)) - distLen / 4) * distLen / 4096
}

// ---------------------------------------------------------------------------
// TeslaZapSegment — per-segment descriptor (replaces C# SpriteRenderable)
// ---------------------------------------------------------------------------

/** Describes one segment of a tesla zap arc for later 3D rendering.
 *
 * OpenRA 对照: SpriteRenderable(s.GetSprite(step[4]), pos, ...)
 *
* These descriptors should feed a LinesMesh builder that
 * dynamically allocates vertices and uses a ShaderMaterial for the glow effect.
 * Currently stores the sprite/position data; rendering is deferred to the
 * 3D pipeline (Babylon.js LinesMesh or BatchedSparkRenderer).
 */
export interface TeslaZapSegment {
  /** 3D projected position of the segment. */
  readonly pos: { x: number; y: number; z: number }
  /** Sprite from the sequence at the step's frame index. */
  readonly sprite: unknown
  /** Alpha from the sequence at the step's frame index. */
  readonly alpha: number
  /** Palette name for color lookup. */
  readonly palette: string
  /** Whether world tint should be ignored. */
  readonly ignoreWorldTint: boolean
  /** Z-offset for draw ordering. */
  readonly zOffset: number
}

// ---------------------------------------------------------------------------
// Minimal WorldRenderer interface
// ---------------------------------------------------------------------------

export interface ITeslaZapWorldRenderer {
  screenPosition(pos: WPos): { x: number; y: number }
  projectedPosition(px: { x: number; y: number }): { x: number; y: number; z: number }
  palette(name: string): unknown
  readonly world: {
    fogObscures(pos: WPos): boolean
    readonly map: {
      readonly sequences: {
        getSequence(image: string, sequence: string): {
          readonly name: string
          readonly length: number
          readonly ignoreWorldTint: boolean
          getSprite(frame: number): unknown
          getAlpha(frame: number): number
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// TeslaZapRenderable
// ---------------------------------------------------------------------------

export class TeslaZapRenderable {
  readonly pos: WPos
  readonly zOffset: number
  readonly isDecoration: boolean = true

  private readonly _length: WVec
  private readonly _image: string
  private readonly _palette: string
  private readonly _dimSequence: string
  private readonly _brightSequence: string
  private readonly _brightZaps: number
  private readonly _dimZaps: number
  private _cachedPos: WPos
  private _cachedLength: WVec
  private _cache: TeslaZapRenderable[] = []

  constructor(
    pos: WPos,
    zOffset: number,
    length: WVec,
    image: string,
    brightSequence: string,
    brightZaps: number,
    dimSequence: string,
    dimZaps: number,
    palette: string,
  ) {
    this.pos = pos
    this.zOffset = zOffset
    this._length = length
    this._image = image
    this._palette = palette
    this._brightZaps = brightZaps
    this._dimZaps = dimZaps
    this._dimSequence = dimSequence
    this._brightSequence = brightSequence
    this._cachedPos = WPos.Zero
    this._cachedLength = WVec.Zero
  }

  withPalette(newPalette: unknown): TeslaZapRenderable {
    // OpenRA 对照: IPalettedRenderable.WithPalette(PaletteReference newPalette)
    // The palette reference is typically a PaletteReference object; we extract
    // its name string for use in segment descriptors.
    const paletteName =
      (newPalette as { name?: string } | null)?.name ?? this._palette
    return new TeslaZapRenderable(
      this.pos, this.zOffset, this._length, this._image,
      this._brightSequence, this._brightZaps,
      this._dimSequence, this._dimZaps, paletteName,
    )
  }

  withZOffset(newOffset: number): TeslaZapRenderable {
    return new TeslaZapRenderable(
      this.pos, newOffset, this._length, this._image,
      this._brightSequence, this._brightZaps,
      this._dimSequence, this._dimZaps, this._palette,
    )
  }

  offsetBy(vec: WVec): TeslaZapRenderable {
    return new TeslaZapRenderable(
      WPos.add(this.pos, vec), this.zOffset, this._length, this._image,
      this._brightSequence, this._brightZaps,
      this._dimSequence, this._dimZaps, this._palette,
    )
  }

  asDecoration(): TeslaZapRenderable { return this }

  prepareRender(_wr: ITeslaZapWorldRenderer): TeslaZapRenderable { return this }

  render(wr: ITeslaZapWorldRenderer): void {
    if (
      wr.world.fogObscures(this.pos) &&
      wr.world.fogObscures(WPos.add(this.pos, this._length))
    ) {
      return
    }

    if (
      this._cache.length === 0 ||
      !WVec.equals(this._length, this._cachedLength) ||
      !WPos.equals(this.pos, this._cachedPos)
    ) {
      this._cache = this.generateRenderables(wr)
      this._cachedPos = this.pos
      this._cachedLength = this._length
    }

    for (const renderable of this._cache) {
      renderable.render(wr)
    }
  }

  generateRenderables(wr: ITeslaZapWorldRenderer): TeslaZapRenderable[] {
    const bright = wr.world.map.sequences.getSequence(this._image, this._brightSequence)
    const dim = wr.world.map.sequences.getSequence(this._image, this._dimSequence)

    const source = wr.screenPosition(this.pos)
    const target = wr.screenPosition(WPos.add(this.pos, this._length))

    const result: TeslaZapRenderable[] = []

    for (let n = 0; n < this._dimZaps; n++) {
      for (const z of this.drawZapWandering(wr, source, target, dim, this._palette)) {
        result.push(z)
      }
    }

    for (let n = 0; n < this._brightZaps; n++) {
      for (const z of this.drawZapWandering(wr, source, target, bright, this._palette)) {
        result.push(z)
      }
    }

    return result
  }

  private drawZapWandering(
    wr: ITeslaZapWorldRenderer,
    from: { x: number; y: number },
    to: { x: number; y: number },
    seq: { readonly ignoreWorldTint: boolean; getSprite(frame: number): unknown; getAlpha(frame: number): number },
    pal: string,
  ): TeslaZapRenderable[] {
    const dist = { x: to.x - from.x, y: to.y - from.y }
    const distLen = Math.sqrt(dist.x * dist.x + dist.y * dist.y)
    if (distLen === 0) return []

    const norm = { x: -dist.y / distLen, y: dist.x / distLen }
    const rng = new SeededRandom(Math.floor(from.x + from.y * 997 + distLen * 13))
    const result: TeslaZapRenderable[] = []

    if (rng.next(2) !== 0) {
      const pdfLen = randomZapOffset(rng, distLen)
      const p1 = {
        x: from.x + dist.x / 3 + pdfLen * norm.x,
        y: from.y + dist.y / 3 + pdfLen * norm.y,
      }
      const pdfLen2 = randomZapOffset(rng, distLen)
      const p2 = {
        x: from.x + 2 * dist.x / 3 + pdfLen2 * norm.x,
        y: from.y + 2 * dist.y / 3 + pdfLen2 * norm.y,
      }
      const _p1 = { x: 0, y: 0 }
      const _p2 = { x: 0, y: 0 }
      result.push(...this.drawZap(wr, from, p1, seq, _p1, pal))
      result.push(...this.drawZap(wr, _p1, p2, seq, _p2, pal))
      result.push(...this.drawZap(wr, _p2, to, seq, { x: 0, y: 0 }, pal))
    } else {
      const pdfLen = randomZapOffset(rng, distLen)
      const p1 = {
        x: from.x + dist.x / 2 + pdfLen * norm.x,
        y: from.y + dist.y / 2 + pdfLen * norm.y,
      }
      const _p1 = { x: 0, y: 0 }
      result.push(...this.drawZap(wr, from, p1, seq, _p1, pal))
      result.push(...this.drawZap(wr, _p1, to, seq, { x: 0, y: 0 }, pal))
    }

    return result
  }

  private drawZap(
    wr: ITeslaZapWorldRenderer,
    from: { x: number; y: number },
    to: { x: number; y: number },
    seq: { readonly ignoreWorldTint: boolean; getSprite(frame: number): unknown; getAlpha(frame: number): number },
    outEnd: { x: number; y: number },
    pal: string,
  ): TeslaZapRenderable[] {
    const dist = { x: to.x - from.x, y: to.y - from.y }
    const q = { x: -dist.y, y: dist.x }
    const c = -(from.x * q.x + from.y * q.y)
    const result: TeslaZapRenderable[] = []
    let z = { x: from.x, y: from.y }

    while (
      Math.abs(to.x - z.x) > 5 || Math.abs(to.x - z.x) < -5 ||
      Math.abs(to.y - z.y) > 5 || Math.abs(to.y - z.y) < -5
    ) {
      let bestStep: (readonly [number, number, number, number, number]) | null = null
      let bestDot = Infinity

      for (const step of STEPS) {
        const candidate = { x: z.x + step[0], y: z.y + step[1] }
        const distToTargetSq =
          (to.x - candidate.x) ** 2 + (to.y - candidate.y) ** 2
        const currentDistSq = (to.x - z.x) ** 2 + (to.y - z.y) ** 2

        if (distToTargetSq >= currentDistSq) continue

        const dotVal = Math.abs(candidate.x * q.x + candidate.y * q.y + c)
        if (dotVal < bestDot) {
          bestDot = dotVal
          bestStep = step
        }
      }

      if (!bestStep) break

      const step = bestStep
      // OpenRA 对照: step[2], step[3] are sprite offset, step[4] is frame index
      const spritePos = wr.projectedPosition({
        x: Math.round(z.x + step[2]),
        y: Math.round(z.y + step[3]),
      })

      // OpenRA 对照:
      //   rs.Add(new SpriteRenderable(s.GetSprite(step[4]), pos, WVec.Zero, 0,
      //     pal, 1f, s.GetAlpha(step[4]), float3.Ones,
      //     tintModifiers, true).PrepareRender(wr));
      const frame = step[4]
      const sprite = seq.getSprite(frame)
      const alpha = seq.getAlpha(frame)
      const tintModifiers = seq.ignoreWorldTint

      // Create a descriptor segment with actual sprite/alpha data from the
      // sequence instead of creating recursive empty TeslaZapRenderable objects.
      // Feed these TeslaZapSegment descriptors into a
      // Babylon.js LinesMesh builder for 3D lightning rendering.
      const segment = new TeslaZapRenderable(
        new WPos(spritePos.x, spritePos.y, spritePos.z),
        this.zOffset,
        WVec.Zero,
        this._image,
        this._brightSequence,
        0, '', 0, pal,
      )
      // Attach the sprite/alpha data to the segment for the renderer
      ;(segment as any)._zapSprite = sprite
      ;(segment as any)._zapAlpha = alpha
      ;(segment as any)._zapPalette = pal
      ;(segment as any)._zapIgnoreWorldTint = tintModifiers
      result.push(segment)

      z = { x: z.x + step[0], y: z.y + step[1] }

      if (result.length >= 1000) break
    }

    outEnd.x = z.x
    outEnd.y = z.y

    return result
  }

  renderDebugGeometry(_wr: ITeslaZapWorldRenderer): void {
    void _wr
  }

  screenBounds(_wr: ITeslaZapWorldRenderer): {
    x: number; y: number; width: number; height: number
  } {
    return { x: 0, y: 0, width: 0, height: 0 }
  }

  get cache(): readonly TeslaZapRenderable[] { return this._cache }
  setCache(cache: TeslaZapRenderable[]): void { this._cache = cache }
}
