/**
 * Voxel.ts — Voxel model in-memory representation
 * OpenRA 对照: OpenRA.Mods.Cnc/Graphics/Voxel.cs
 *
 * 核心范式转换:
 * - C# Voxel:IModel with CPU-side limb data → TypeScript IModel wrapper
 *   around pre-loaded glTF TransformNode hierarchy (ADR-19.1)
 * - C# float[16] matrix arrays → Float32Array for typed performance
 * - C# Limb struct with bounds/size/renderData → logical limb grouping
 * - C# AggregateBounds (min sphere covering all frame rotations) →
 *   pre-computed from glTF bounding box
 * - C# Size getter (max-pooled limb dimensions) → pre-computed Float32Array
 *
 * ADR-19.1:
 * - Voxel data (.vxl/.hva) is pre-converted to .glb at build time.
 * - At runtime, Voxel class is a thin wrapper referencing the loaded
 *   TransformNode + pre-extracted transform metadata.
 * - Multi-part models use parent-child TransformNode hierarchy.
 */

import type { IModel, ModelRenderData } from '../../OpenRA.Game/Graphics/Model'
import { Rectangle } from '../../OpenRA.Game/Primitives/Rectangle'
import type { HvaReader } from '../FileFormats/HvaReader'

// ---------------------------------------------------------------------------
// LimbData — internal per-limb storage
// ---------------------------------------------------------------------------

/** Per-limb data stored inside a Voxel.
 *
 * OpenRA 对照: Limb struct in Voxel.cs
 */
interface LimbData {
  scale: number
  bounds: Float32Array // 6 floats: minX,Y,Z + maxX,Y,Z
  size: Uint8Array // 3 bytes: sizeX, sizeY, sizeZ
  renderData: ModelRenderData
}

// ---------------------------------------------------------------------------
// Voxel
// ---------------------------------------------------------------------------

/** Represents a single loaded voxel model.
 *
 * OpenRA 对照: Voxel class (IModel implementation)
 *
 * Under ADR-19.1, this stores the transformation matrices extracted from
 * .hva data and the limb metadata extracted from .vxl data. The actual
 * render geometry is stored in a glTF asset referenced by renderData.
 */
export class Voxel implements IModel {
  readonly frames: number
  readonly sections: number

  private readonly limbData: LimbData[]
  private readonly transforms: Float32Array // from HvaReader
  private _size: Float32Array | null = null
  private _aggregateBounds: Rectangle | null = null

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /** Construct a Voxel from parsed VXL and HVA data.
   *
   * OpenRA 对照: Voxel(VoxelLoader loader, VxlReader vxl, HvaReader hva, ...)
   *
   * Under ADR-19.1, `renderData` for each limb is provided by the loader
   * (references to pre-loaded glTF mesh nodes) rather than generated
   * by a software rasterizer.
   *
   * @param hva — parsed HVA animation data
   * @param limbBounds — per-limb bounding boxes from VXL
   * @param limbSizes — per-limb dimensions from VXL
   * @param limbScales — per-limb scale factors from VXL
   * @param limbRenderData — per-limb render data (glTF mesh references)
   * @throws if limb counts don't match
   */
  constructor(
    hva: HvaReader,
    limbBounds: Float32Array[],
    limbSizes: Uint8Array[],
    limbScales: number[],
    limbRenderData: ModelRenderData[],
  ) {
    const limbCount = hva.limbCount

    if (limbBounds.length !== limbCount)
      throw new Error(`Limb bounds count (${limbBounds.length}) doesn't match HVA limb count (${limbCount}).`)
    if (limbSizes.length !== limbCount)
      throw new Error(`Limb sizes count (${limbSizes.length}) doesn't match HVA limb count (${limbCount}).`)
    if (limbScales.length !== limbCount)
      throw new Error(`Limb scales count (${limbScales.length}) doesn't match HVA limb count (${limbCount}).`)
    if (limbRenderData.length !== limbCount)
      throw new Error(`Limb renderData count (${limbRenderData.length}) doesn't match HVA limb count (${limbCount}).`)

    this.transforms = hva.transforms
    this.frames = hva.frameCount
    this.sections = hva.limbCount

    this.limbData = []
    for (let i = 0; i < limbCount; i++) {
      this.limbData.push({
        scale: limbScales[i],
        bounds: limbBounds[i],
        size: limbSizes[i],
        renderData: limbRenderData[i],
      })
    }
  }

  // -----------------------------------------------------------------------
  // IModel.TransformationMatrix
  // -----------------------------------------------------------------------

  /** Get the 4x4 column-major transformation matrix for a limb at a given frame.
   *
   * OpenRA 对照: Voxel.TransformationMatrix(uint limb, uint frame)
   *
   * The C# version applies the following chain:
   *   1. Start with HVA transform
   *   2. Fix limb position (translate by scaled dimensions)
   *   3. Center, flip, and scale: ScaleMatrix(scale, -scale, scale) *
   *      TranslationMatrix(bounds[0], bounds[1], bounds[2])
   *
   * Under ADR-19.1, these matrices are applied to TransformNode children
   * in the glTF hierarchy.
   */
  transformationMatrix(limb: number, frame: number): Float32Array<ArrayBufferLike> {
    if (frame >= this.frames)
      throw new Error(`Only ${this.frames} frames exist.`)
    if (limb >= this.sections)
      throw new Error(`Only ${this.sections} limbs exist.`)

    const l = this.limbData[limb]
    const t = new Float32Array(16)
    const baseIdx = 16 * (this.sections * frame + limb)
    for (let i = 0; i < 16; i++) {
      t[i] = this.transforms[baseIdx + i]
    }

    // Fix limb position (translation components)
    t[12] *= l.scale * (l.bounds[3] - l.bounds[0]) / l.size[0]
    t[13] *= l.scale * (l.bounds[4] - l.bounds[1]) / l.size[1]
    t[14] *= l.scale * (l.bounds[5] - l.bounds[2]) / l.size[2]

    // Center, flip and scale
    // t = ScaleMatrix(l.scale, -l.scale, l.scale) * TranslationMatrix(...) * t
    // NOTE: Under ADR-19.1, this matrix math can optionally be pre-baked
    // into the glTF node transforms during the build conversion step.
    return Voxel._matrixMultiply(
      Voxel._scaleMatrix(l.scale, -l.scale, l.scale),
      Voxel._matrixMultiply(
        Voxel._translationMatrix(l.bounds[0], l.bounds[1], l.bounds[2]),
        t,
      ),
    )
  }

  // -----------------------------------------------------------------------
  // IModel.Size
  // -----------------------------------------------------------------------

  /** Overall model size (computed as max over all scaled limbs).
   *
   * OpenRA 对照: Voxel.Size getter
   */
  get size(): Float32Array {
    if (this._size) return this._size

    const result = new Float32Array(3)
    for (const ld of this.limbData) {
      for (let i = 0; i < 3; i++) {
        const dim = ld.scale * ld.size[i]
        if (dim > result[i]) result[i] = dim
      }
    }

    this._size = result
    return result
  }

  // -----------------------------------------------------------------------
  // IModel.Bounds
  // -----------------------------------------------------------------------

  /** Compute the combined axis-aligned bounding box for all limbs at a given frame.
   *
   * OpenRA 对照: Voxel.Bounds(uint frame)
   */
  bounds(frame: number): Float32Array {
    const ret = new Float32Array([
      Infinity, Infinity, Infinity,
      -Infinity, -Infinity, -Infinity,
    ])

    for (let j = 0; j < this.sections; j++) {
      const l = this.limbData[j]
      // Limb corner offsets
      const b = new Float32Array([
        0, 0, 0,
        l.bounds[3] - l.bounds[0],
        l.bounds[4] - l.bounds[1],
        l.bounds[5] - l.bounds[2],
      ])

      // Transform bounding box corners
      const mat = this.transformationMatrix(j, frame)
      const bb = Voxel._matrixAABBMultiply(mat, b)

      for (let i = 0; i < 3; i++) {
        ret[i] = Math.min(ret[i], bb[i])
        ret[i + 3] = Math.max(ret[i + 3], bb[i + 3])
      }
    }

    return ret
  }

  // -----------------------------------------------------------------------
  // IModel.RenderData
  // -----------------------------------------------------------------------

  /** Get render data for a limb section.
   *
   * OpenRA 对照: Voxel.RenderData(uint limb)
   */
  renderData(limb: number): ModelRenderData {
    return this.limbData[limb].renderData
  }

  // -----------------------------------------------------------------------
  // IModel.AggregateBounds
  // -----------------------------------------------------------------------

  /** Smallest sphere that covers all rotations of all frames, converted to
   * a square Rectangle.
   *
   * OpenRA 对照: Voxel.AggregateBounds
   */
  get aggregateBounds(): Rectangle {
    if (this._aggregateBounds) return this._aggregateBounds

    // Corner indices for 8 bounding box corners
    const ix = [0, 0, 0, 0, 3, 3, 3, 3]
    const iy = [1, 1, 4, 4, 1, 1, 4, 4]
    const iz = [2, 5, 2, 5, 2, 5, 2, 5]

    let rSquared = 0
    for (let f = 0; f < this.frames; f++) {
      const b = this.bounds(f)
      for (let i = 0; i < 8; i++) {
        const x = b[ix[i]]
        const y = b[iy[i]]
        const z = b[iz[i]]
        rSquared = Math.max(rSquared, x * x + y * y + z * z)
      }
    }

    const r = Math.ceil(Math.sqrt(rSquared)) + 1
    this._aggregateBounds = Rectangle.fromLTRB(-r, -r, r, r)
    return this._aggregateBounds
  }

  // -----------------------------------------------------------------------
  // Private matrix utilities (mirrors C# Util matrix functions)
  // -----------------------------------------------------------------------

  /** 4x4 column-major scale matrix.
   *
   * OpenRA 对照: Util.ScaleMatrix(float, float, float)
   */
  private static _scaleMatrix(
    sx: number,
    sy: number,
    sz: number,
  ): Float32Array<ArrayBufferLike> {
    const m = new Float32Array(16)
    m[0] = sx
    m[5] = sy
    m[10] = sz
    m[15] = 1
    return m
  }

  /** 4x4 column-major translation matrix.
   *
   * OpenRA 对照: Util.TranslationMatrix(float, float, float)
   */
  private static _translationMatrix(
    tx: number,
    ty: number,
    tz: number,
  ): Float32Array {
    const m = new Float32Array(16)
    m[0] = 1
    m[5] = 1
    m[10] = 1
    m[15] = 1
    m[12] = tx
    m[13] = ty
    m[14] = tz
    return m
  }

  /** Multiply two 4x4 column-major matrices: a * b.
   *
   * OpenRA 对照: Util.MatrixMultiply(float[], float[])
   */
  private static _matrixMultiply(
    a: Float32Array,
    b: Float32Array,
  ): Float32Array {
    const result = new Float32Array(16)
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let sum = 0
        for (let k = 0; k < 4; k++) {
          sum += a[i + 4 * k] * b[k + 4 * j]
        }
        result[i + 4 * j] = sum
      }
    }
    return result
  }

  /** Transform an AABB [minX, minY, minZ, maxX, maxY, maxZ] by a matrix.
   *
   * OpenRA 对照: Util.MatrixAABBMultiply(float[], float[])
   */
  private static _matrixAABBMultiply(
    mtx: Float32Array,
    bounds: Float32Array,
  ): Float32Array {
    const result = new Float32Array([
      Infinity, Infinity, Infinity,
      -Infinity, -Infinity, -Infinity,
    ])
    // Transform all 8 corners
    const corners = [
      [bounds[0], bounds[1], bounds[2]],
      [bounds[3], bounds[1], bounds[2]],
      [bounds[0], bounds[4], bounds[2]],
      [bounds[3], bounds[4], bounds[2]],
      [bounds[0], bounds[1], bounds[5]],
      [bounds[3], bounds[1], bounds[5]],
      [bounds[0], bounds[4], bounds[5]],
      [bounds[3], bounds[4], bounds[5]],
    ]

    for (const c of corners) {
      const p = Voxel._matrixVectorMultiply(mtx, c)
      result[0] = Math.min(result[0], p[0])
      result[1] = Math.min(result[1], p[1])
      result[2] = Math.min(result[2], p[2])
      result[3] = Math.max(result[3], p[0])
      result[4] = Math.max(result[4], p[1])
      result[5] = Math.max(result[5], p[2])
    }

    return result
  }

  /** Multiply a 4x4 column-major matrix by a 4D vector.
   *
   * OpenRA 对照: Util.MatrixVectorMultiply(float[], float[])
   */
  private static _matrixVectorMultiply(
    m: Float32Array,
    v: number[],
  ): Float32Array {
    const result = new Float32Array(4)
    for (let i = 0; i < 4; i++) {
      result[i] =
        m[i] * v[0] + m[i + 4] * v[1] + m[i + 8] * v[2] + m[i + 12] * v[3]
    }
    return result
  }
}
