/**
 * Util.ts — C&C-specific utility functions (ClassicFacing, matrix math)
 * OpenRA 对照: OpenRA.Mods.Cnc/Util.cs
 *
 * 核心范式转换:
 * - C# static class with WAngle, Int32Matrix4x4 → TypeScript module with WAngle imports
 * - C# Common.Util.IndexFacing/QuantizeFacing → inline TypeScript fallback
 * - C# float[] row-major 4x4 matrices → same Float32Array row-major representation
 */

import { WAngle } from '../OpenRA.Game/WAngle.js'
import type { Int32Matrix4x4 } from '../OpenRA.Game/Int32Matrix4x4.js'

// ---------------------------------------------------------------------------
// Facing Constants (对应 OpenRA Util.SpriteRanges / SpriteFacings)
// ---------------------------------------------------------------------------

/**
 * Non-linear sprite frame ranges for 32-facing C&C sprites.
 *
 * OpenRA 对照: Util.SpriteRanges
 *
 * Each entry is the exclusive maximum facing angle for that frame index.
 * Frame 0 is used for angles < 20 or >= 1000.
 */
const SPRITE_RANGES: readonly number[] = [
  20, 56, 88, 132, 156, 184, 212, 240,
  268, 296, 324, 352, 384, 416, 452, 488,
  532, 568, 604, 644, 668, 696, 724, 752,
  780, 808, 836, 864, 896, 928, 964, 1000,
]

/**
 * Actual facing value for each sprite frame index in 32-facing sprites.
 *
 * OpenRA 对照: Util.SpriteFacings
 */
const SPRITE_FACINGS: readonly WAngle[] = [
  WAngle.Zero,
  new WAngle(40),
  new WAngle(74),
  new WAngle(112),
  new WAngle(146),
  new WAngle(172),
  new WAngle(200),
  new WAngle(228),
  new WAngle(256),
  new WAngle(284),
  new WAngle(312),
  new WAngle(340),
  new WAngle(370),
  new WAngle(402),
  new WAngle(436),
  new WAngle(472),
  new WAngle(512),
  new WAngle(552),
  new WAngle(588),
  new WAngle(626),
  new WAngle(658),
  new WAngle(684),
  new WAngle(712),
  new WAngle(740),
  new WAngle(768),
  new WAngle(796),
  new WAngle(824),
  new WAngle(852),
  new WAngle(882),
  new WAngle(914),
  new WAngle(948),
  new WAngle(984),
]

// ---------------------------------------------------------------------------
// Classic Facing Functions
// ---------------------------------------------------------------------------

/**
 * Calculate the frame index (0..numFrames-1) for a given facing, accounting
 * for the non-linear C&C mapping when numFrames is 32.
 *
 * OpenRA 对照: Util.ClassicIndexFacing(WAngle, int)
 *
 * For 32-facing sprites, uses the SPRITE_RANGES lookup table to map
 * the actual facing angle to a non-linear frame index. For any other
 * frame count, delegates to standard uniform quantization.
 *
 * @param facing — the facing angle
 * @param numFrames — total number of sprite frames
 * @returns frame index in [0, numFrames)
 */
export function classicIndexFacing(facing: WAngle, numFrames: number): number {
  if (numFrames === 32) {
    const angle = facing.angle
    for (let i = 0; i < SPRITE_RANGES.length; i++) {
      if (angle < SPRITE_RANGES[i]) {
        return i
      }
    }
    return 0
  }

  return indexFacingUniform(facing, numFrames)
}

/**
 * Quantize a facing to the nearest discrete direction, accounting for
 * the non-linear C&C mapping when steps is 32.
 *
 * OpenRA 对照: Util.ClassicQuantizeFacing(WAngle, int)
 *
 * For 32-facing sprites, returns the actual facing from SPRITE_FACINGS
 * corresponding to the classic frame index. For any other step count,
 * delegates to standard uniform quantization.
 *
 * @param facing — the facing angle to quantize
 * @param steps — number of discrete facing steps
 * @returns the quantized WAngle
 */
export function classicQuantizeFacing(facing: WAngle, steps: number): WAngle {
  if (steps === 32) {
    return SPRITE_FACINGS[classicIndexFacing(facing, steps)]
  }

  return quantizeFacingUniform(facing, steps)
}

// ---------------------------------------------------------------------------
// Uniform Facing Helpers (replicates Common.Util.IndexFacing / QuantizeFacing)
// ---------------------------------------------------------------------------

/**
 * Standard uniform frame index calculation.
 *
 * OpenRA 对照: Common.Util.IndexFacing(WAngle, int)
 *
 * Uses integer math: step = 1024/numFrames, then
 *   index = ((angle + step/2) & 1023) / step
 *
 * @param facing — facing angle
 * @param numFrames — number of frames
 * @returns frame index
 */
function indexFacingUniform(facing: WAngle, numFrames: number): number {
  const step = Math.floor(1024 / numFrames)
  const a = (facing.angle + Math.floor(step / 2)) & 1023
  return Math.floor(a / step)
}

/**
 * Standard uniform facing quantization.
 *
 * OpenRA 对照: Common.Util.QuantizeFacing(WAngle, int)
 *
 * @param facing — facing to quantize
 * @param steps — number of discrete steps
 * @returns quantized WAngle
 */
function quantizeFacingUniform(facing: WAngle, steps: number): WAngle {
  const step = Math.floor(1024 / steps)
  const index = indexFacingUniform(facing, steps)
  return new WAngle(index * step)
}

// ---------------------------------------------------------------------------
// Matrix Utilities (对应 OpenRA Util matrix methods)
// ---------------------------------------------------------------------------

/**
 * Create a 4x4 identity matrix (row-major, 16 floats).
 *
 * OpenRA 对照: Util.IdentityMatrix()
 */
export function identityMatrix(): Float32Array {
  const m = new Float32Array(16)
  m[0] = 1
  m[5] = 1
  m[10] = 1
  m[15] = 1
  return m
}

/**
 * Create a 4x4 scale matrix (row-major, 16 floats).
 *
 * OpenRA 对照: Util.ScaleMatrix(float, float, float)
 */
export function scaleMatrix(sx: number, sy: number, sz: number): Float32Array {
  const m = new Float32Array(16)
  m[0] = sx
  m[5] = sy
  m[10] = sz
  m[15] = 1
  return m
}

/**
 * Create a 4x4 translation matrix (row-major, 16 floats).
 *
 * OpenRA 对照: Util.TranslationMatrix(float, float, float)
 */
export function translationMatrix(x: number, y: number, z: number): Float32Array {
  const m = new Float32Array(16)
  m[0] = 1
  m[5] = 1
  m[10] = 1
  m[12] = x
  m[13] = y
  m[14] = z
  m[15] = 1
  return m
}

/**
 * Multiply two 4x4 row-major matrices: result = lhs * rhs.
 *
 * OpenRA 对照: Util.MatrixMultiply(float[], float[])
 *
 * In row-major layout, mtx[4*row + col] holds element at (row, col).
 * C# stores column-major implicitly but the source code treats the
 * 16-element float[] as row-major. The multiplication: result[i,j] =
 * sum_k lhs[k,j] * rhs[i,k], matching C#'s output.
 *
 * @param lhs — left matrix (16 floats, row-major)
 * @param rhs — right matrix (16 floats, row-major)
 * @returns product matrix (16 floats, row-major)
 */
export function matrixMultiply(lhs: Float32Array, rhs: Float32Array): Float32Array {
  const mtx = new Float32Array(16)
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      mtx[4 * i + j] = 0
      for (let k = 0; k < 4; k++) {
        mtx[4 * i + j] += lhs[4 * k + j] * rhs[4 * i + k]
      }
    }
  }
  return mtx
}

/**
 * Multiply a 4x4 matrix by a 4-element vector.
 *
 * OpenRA 对照: Util.MatrixVectorMultiply(float[], float[])
 *
 * @param mtx — 4x4 row-major matrix (16 floats)
 * @param vec — 4-element vector
 * @returns 4-element result vector
 */
export function matrixVectorMultiply(mtx: Float32Array, vec: Float32Array): Float32Array {
  const ret = new Float32Array(4)
  for (let j = 0; j < 4; j++) {
    ret[j] = 0
    for (let k = 0; k < 4; k++) {
      ret[j] += mtx[4 * k + j] * vec[k]
    }
  }
  return ret
}

/**
 * Compute the inverse of a 4x4 row-major matrix.
 *
 * OpenRA 对照: Util.MatrixInverse(float[])
 *
 * Uses cofactor expansion. Returns null if the matrix is singular.
 *
 * @param m — 4x4 row-major matrix (16 floats)
 * @returns inverse matrix, or null if singular
 */
export function matrixInverse(m: Float32Array): Float32Array | null {
  const mtx = new Float32Array(16)

  mtx[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10]
  mtx[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10]
  mtx[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9]
  mtx[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9]

  mtx[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10]
  mtx[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10]
  mtx[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9]
  mtx[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9]

  mtx[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6]
  mtx[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6]
  mtx[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5]
  mtx[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5]

  mtx[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6]
  mtx[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6]
  mtx[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5]
  mtx[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5]

  const det = m[0] * mtx[0] + m[1] * mtx[4] + m[2] * mtx[8] + m[3] * mtx[12]
  if (det === 0) {
    return null
  }

  for (let i = 0; i < 16; i++) {
    mtx[i] *= 1 / det
  }

  return mtx
}

/**
 * Convert an Int32Matrix4x4 to a float row-major matrix.
 *
 * OpenRA 对照: Util.MakeFloatMatrix(Int32Matrix4x4)
 *
 * @param imtx — integer 4x4 matrix
 * @returns 16-float row-major matrix
 */
export function makeFloatMatrix(imtx: Int32Matrix4x4): Float32Array {
  const multiplier = 1 / imtx.m44
  const m = new Float32Array(16)
  m[0] = imtx.m11 * multiplier
  m[1] = imtx.m12 * multiplier
  m[2] = imtx.m13 * multiplier
  m[3] = imtx.m14 * multiplier
  m[4] = imtx.m21 * multiplier
  m[5] = imtx.m22 * multiplier
  m[6] = imtx.m23 * multiplier
  m[7] = imtx.m24 * multiplier
  m[8] = imtx.m31 * multiplier
  m[9] = imtx.m32 * multiplier
  m[10] = imtx.m33 * multiplier
  m[11] = imtx.m34 * multiplier
  m[12] = imtx.m41 * multiplier
  m[13] = imtx.m42 * multiplier
  m[14] = imtx.m43 * multiplier
  m[15] = imtx.m44 * multiplier
  return m
}

/**
 * Transform an axis-aligned bounding box by a 4x4 matrix.
 *
 * OpenRA 对照: Util.MatrixAABBMultiply(float[], float[])
 *
 * @param mtx — 4x4 row-major matrix (16 floats)
 * @param bounds — [minX, minY, minZ, maxX, maxY, maxZ] (6 floats)
 * @returns transformed bounds [minX, minY, minZ, maxX, maxY, maxZ]
 */
export function matrixAABBMultiply(mtx: Float32Array, bounds: Float32Array): Float32Array {
  // Corner offsets for the 8 corners of the AABB
  const ix = [0, 0, 0, 0, 3, 3, 3, 3]
  const iy = [1, 1, 4, 4, 1, 1, 4, 4]
  const iz = [2, 5, 2, 5, 2, 5, 2, 5]

  const ret = new Float32Array([
    Infinity, Infinity, Infinity,
    -Infinity, -Infinity, -Infinity,
  ])

  for (let i = 0; i < 8; i++) {
    const vec = new Float32Array([bounds[ix[i]], bounds[iy[i]], bounds[iz[i]], 1])
    const tvec = matrixVectorMultiply(mtx, vec)

    ret[0] = Math.min(ret[0], tvec[0] / tvec[3])
    ret[1] = Math.min(ret[1], tvec[1] / tvec[3])
    ret[2] = Math.min(ret[2], tvec[2] / tvec[3])
    ret[3] = Math.max(ret[3], tvec[0] / tvec[3])
    ret[4] = Math.max(ret[4], tvec[1] / tvec[3])
    ret[5] = Math.max(ret[5], tvec[2] / tvec[3])
  }

  return ret
}
