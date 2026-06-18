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
 * - C# SpriteRenderable (per-segment real sprite) → TS TeslaZap3DSegment + LinesMesh
 *
 * 3D rendering: LinesMesh instances with emissive ShaderMaterial for bright/dim zaps,
 * dynamic vertex updates each frame for jitter/branching effects.
 */

import { WPos } from '../../OpenRA.Game/WPos.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import {
  type LinesMesh,
  type ShaderMaterial,
  type Scene,
  Vector3,
  MeshBuilder,
} from '@babylonjs/core'

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
// TeslaZap3DSegment — 3D segment descriptor (replaces C# SpriteRenderable)
// ---------------------------------------------------------------------------

/** Describes one segment point of a tesla zap arc for 3D LinesMesh rendering.
 *
 * OpenRA 对照: SpriteRenderable(s.GetSprite(step[4]), pos, ...)
 *
 * Each point represents a vertex on the lightning arc path.
 * Consecutive points are connected by LinesMesh segments.
 */
export interface TeslaZap3DSegment {
  /** 3D world-space position of the segment point. */
  readonly pos: { x: number; y: number; z: number }
}

/** Describes one complete zap path from source to target.
 *
 * OpenRA 对照: A single continuous arc from one drawZapWandering call.
 */
export interface TeslaZapPath {
  /** Whether this is a bright (true) or dim (false) zap. */
  readonly bright: boolean
  /** 3D world-space positions of segment points along the path. */
  readonly points: readonly { x: number; y: number; z: number }[]
  /** Palette reference name for color lookup. */
  readonly palette: string
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
// TeslaZapMeshBuilder — builds and manages LinesMesh instances from zap paths
// ---------------------------------------------------------------------------

/** Creates and manages Babylon.js LinesMesh instances for tesla zap effects.
 *
 * OpenRA 对照: SpriteRenderable batch → LinesMesh with ShaderMaterial
 *
 * Each zap path becomes a LinesMesh with emissive-only ShaderMaterial.
 * Bright zaps use thick cyan lines; dim zaps use thin blue lines.
 * Vertex positions are updated each frame for jitter effects.
 */
export class TeslaZapMeshBuilder {
  private _brightMaterial: ShaderMaterial
  private _dimMaterial: ShaderMaterial
  private _meshes: LinesMesh[] = []
  private _baseSeed: number

  /** Create a new TeslaZapMeshBuilder.
   *
   * @param scene — the Babylon.js scene to add meshes to
   * @param brightMaterial — ShaderMaterial for bright zaps (emissive cyan)
   * @param dimMaterial — ShaderMaterial for dim zaps (emissive blue)
   * @param baseSeed — seed for per-frame jitter randomization
   */
  constructor(
    scene: Scene,
    brightMaterial: ShaderMaterial,
    dimMaterial: ShaderMaterial,
    baseSeed: number = 42,
  ) {
    void scene
    this._brightMaterial = brightMaterial
    this._dimMaterial = dimMaterial
    this._baseSeed = baseSeed
  }

  /** The bright zap material (thick cyan emissive lines). */
  get brightMaterial(): ShaderMaterial { return this._brightMaterial }
  /** The dim zap material (thin blue emissive lines). */
  get dimMaterial(): ShaderMaterial { return this._dimMaterial }
  /** All managed LinesMesh instances. */
  get meshes(): readonly LinesMesh[] { return this._meshes }

  /** Build LinesMesh instances from zap paths.
   *
   * Each path produces one LinesMesh. Consecutive points are connected by line segments.
   *
   * @param paths — zap paths with 3D point data
   * @returns the created LinesMesh instances
   */
  buildZaps(paths: readonly TeslaZapPath[]): LinesMesh[] {
    // Dispose old meshes
    for (const mesh of this._meshes) {
      mesh.dispose()
    }
    this._meshes = []

    for (const path of paths) {
      if (path.points.length < 2) continue

      const material = path.bright ? this._brightMaterial : this._dimMaterial
      const name = path.bright ? 'teslaZapBright' : 'teslaZapDim'

      // Build vertex array: [x0,y0,z0, x1,y1,z1, x2,y2,z2, ...]
      const vertices: number[] = []
      for (const p of path.points) {
        vertices.push(p.x, p.y, p.z)
      }

      // Use CreateLines for a line strip
      const linesMesh = MeshBuilder.CreateLines(
        name + '_' + this._meshes.length,
        { points: path.points.map(p => new Vector3(p.x, p.y, p.z)) },
      )
      linesMesh.material = material
      linesMesh.isPickable = false

      this._meshes.push(linesMesh)
    }

    return this._meshes
  }

  /** Update vertex positions with jitter offset for lightning branching effect.
   *
   * Called each frame to apply random jitter to the zap vertices.
   *
   * @param tickCount — current tick for deterministic pseudo-random jitter
   */
  updateJitter(tickCount: number): void {
    const rng = new SeededRandom(this._baseSeed + tickCount * 9973)
    const jitterMax = 0.5 // max jitter in world units

    for (const mesh of this._meshes) {
      const positions = mesh.getVerticesData('position')
      if (!positions) continue

      const jittered = new Float32Array(positions.length)
      for (let i = 0; i < positions.length; i += 3) {
        const jx = (rng.next(100) / 100 - 0.5) * 2 * jitterMax
        const jy = (rng.next(100) / 100 - 0.5) * 2 * jitterMax
        const jz = (rng.next(100) / 100 - 0.5) * 2 * jitterMax
        jittered[i] = positions[i] + jx
        jittered[i + 1] = positions[i + 1] + jy
        jittered[i + 2] = positions[i + 2] + jz
      }
      mesh.updateVerticesData('position', jittered, false, true)
    }
  }

  /** Dispose all GPU resources (LinesMesh instances).
   *
   * Call when the zap effect is complete and no longer needed.
   */
  dispose(): void {
    for (const mesh of this._meshes) {
      mesh.dispose()
    }
    this._meshes = []
    this._brightMaterial.dispose()
    this._dimMaterial.dispose()
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

  /** Accumulated 3D zap paths for mesh building (populated by generateRenderables). */
  private _zapPaths: TeslaZapPath[] = []

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

  /** Render the zap effect, producing 3D zap paths for LinesMesh construction.
   *
   * After calling render(), use getZapPaths() to retrieve the segment data
   * and build 3D LinesMesh instances via TeslaZapMeshBuilder.
   *
   * @param wr — the world renderer for screen-space projection
   */
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
      this._zapPaths = []
      this._cache = this.generateRenderables(wr)
      this._cachedPos = this.pos
      this._cachedLength = this._length
    }

    for (const renderable of this._cache) {
      renderable.render(wr)
    }
  }

  /** Build 3D LinesMesh instances from the generated zap paths.
   *
   * Must be called after render() to get the latest segment data.
   *
   * @param builder — the TeslaZapMeshBuilder to use for mesh construction
   * @returns the created LinesMesh instances
   */
  build3DMeshes(builder: TeslaZapMeshBuilder): LinesMesh[] {
    // Collect paths from cache children too
    const allPaths: TeslaZapPath[] = [...this._zapPaths]
    for (const child of this._cache) {
      allPaths.push(...child._zapPaths)
    }
    return builder.buildZaps(allPaths)
  }

  /** Get the accumulated 3D zap paths (populated by render/generateRenderables).
   *
   * @returns array of zap path descriptors for mesh building
   */
  getZapPaths(): readonly TeslaZapPath[] {
    return this._zapPaths
  }

  generateRenderables(wr: ITeslaZapWorldRenderer): TeslaZapRenderable[] {
    const bright = wr.world.map.sequences.getSequence(this._image, this._brightSequence)
    const dim = wr.world.map.sequences.getSequence(this._image, this._dimSequence)

    const source = wr.screenPosition(this.pos)
    const target = wr.screenPosition(WPos.add(this.pos, this._length))

    const result: TeslaZapRenderable[] = []
    this._zapPaths = []

    for (let n = 0; n < this._dimZaps; n++) {
      const { renderables, path } = this.drawZapWandering(
        wr, source, target, dim, this._palette, false,
      )
      result.push(...renderables)
      if (path.length >= 2) {
        this._zapPaths.push({ bright: false, points: path, palette: this._palette })
      }
    }

    for (let n = 0; n < this._brightZaps; n++) {
      const { renderables, path } = this.drawZapWandering(
        wr, source, target, bright, this._palette, true,
      )
      result.push(...renderables)
      if (path.length >= 2) {
        this._zapPaths.push({ bright: true, points: path, palette: this._palette })
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
    bright: boolean,
  ): { renderables: TeslaZapRenderable[]; path: { x: number; y: number; z: number }[] } {
    const dist = { x: to.x - from.x, y: to.y - from.y }
    const distLen = Math.sqrt(dist.x * dist.x + dist.y * dist.y)
    if (distLen === 0) return { renderables: [], path: [] }

    const norm = { x: -dist.y / distLen, y: dist.x / distLen }
    const rng = new SeededRandom(Math.floor(from.x + from.y * 997 + distLen * 13))
    const result: TeslaZapRenderable[] = []
    const pathPoints: { x: number; y: number; z: number }[] = []

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

      const r1 = this.drawZap(wr, from, p1, seq, _p1, pal, bright)
      result.push(...r1.renderables)
      pathPoints.push(...r1.pathPoints)

      const r2 = this.drawZap(wr, _p1, p2, seq, _p2, pal, bright)
      result.push(...r2.renderables)
      pathPoints.push(...r2.pathPoints)

      const r3 = this.drawZap(wr, _p2, to, seq, { x: 0, y: 0 }, pal, bright)
      result.push(...r3.renderables)
      pathPoints.push(...r3.pathPoints)
    } else {
      const pdfLen = randomZapOffset(rng, distLen)
      const p1 = {
        x: from.x + dist.x / 2 + pdfLen * norm.x,
        y: from.y + dist.y / 2 + pdfLen * norm.y,
      }
      const _p1 = { x: 0, y: 0 }

      const r1 = this.drawZap(wr, from, p1, seq, _p1, pal, bright)
      result.push(...r1.renderables)
      pathPoints.push(...r1.pathPoints)

      const r2 = this.drawZap(wr, _p1, to, seq, { x: 0, y: 0 }, pal, bright)
      result.push(...r2.renderables)
      pathPoints.push(...r2.pathPoints)
    }

    return { renderables: result, path: pathPoints }
  }

  private drawZap(
    wr: ITeslaZapWorldRenderer,
    from: { x: number; y: number },
    to: { x: number; y: number },
    seq: { readonly ignoreWorldTint: boolean; getSprite(frame: number): unknown; getAlpha(frame: number): number },
    outEnd: { x: number; y: number },
    pal: string,
    _bright: boolean,
  ): { renderables: TeslaZapRenderable[]; pathPoints: { x: number; y: number; z: number }[] } {
    const dist = { x: to.x - from.x, y: to.y - from.y }
    const q = { x: -dist.y, y: dist.x }
    const c = -(from.x * q.x + from.y * q.y)
    const result: TeslaZapRenderable[] = []
    const pathPoints: { x: number; y: number; z: number }[] = []
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

      // Accumulate 3D position for mesh building
      pathPoints.push({ x: spritePos.x, y: spritePos.y, z: spritePos.z })

      // OpenRA 对照:
      //   rs.Add(new SpriteRenderable(s.GetSprite(step[4]), pos, WVec.Zero, 0,
      //     pal, 1f, s.GetAlpha(step[4]), float3.Ones,
      //     tintModifiers, true).PrepareRender(wr));
      const frame = step[4]
      const sprite = seq.getSprite(frame)
      const alpha = seq.getAlpha(frame)
      const tintModifiers = seq.ignoreWorldTint

      const segment = new TeslaZapRenderable(
        new WPos(spritePos.x, spritePos.y, spritePos.z),
        this.zOffset,
        WVec.Zero,
        this._image,
        this._brightSequence,
        0, '', 0, pal,
      )
      // Attach the sprite/alpha data to the segment
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

    return { renderables: result, pathPoints }
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

  /** Source position (for testing/stub compatibility). */
  get source(): WPos { return this.pos }
  /** Target offset vector (for testing/stub compatibility). */
  get targetOffset(): WVec { return this._length }
  /** Sprite image name. */
  get image(): string { return this._image }
  /** Bright zap sequence name. */
  get brightSequence(): string { return this._brightSequence }
  /** Number of bright zaps. */
  get brightZaps(): number { return this._brightZaps }
  /** Dim zap sequence name. */
  get dimSequence(): string { return this._dimSequence }
  /** Number of dim zaps. */
  get dimZaps(): number { return this._dimZaps }
  /** Palette name. */
  get palette(): string { return this._palette }
}
