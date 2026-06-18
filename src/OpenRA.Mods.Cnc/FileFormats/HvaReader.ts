/**
 * HvaReader.ts — Westwood HVA voxel animation file reader
 * OpenRA 对照: OpenRA.Mods.Cnc/FileFormats/HvaReader.cs
 *
 * 核心范式转换:
 * - C# Stream + BinaryReader → TypeScript DataView on Uint8Array
 * - C# float array with row-major→column-major transpose → direct column-major Float32Array
 * - C# Util.MatrixInverse validation → precondition check (non-singular matrices)
 *
 * ADR-19.1 Impact:
 * - Used as a build-time format reader for .hva→glTF animation extraction.
 * - At runtime, animation transforms are baked into glTF animation clips.
 * - Runtime HvaReader serves as a thin validation wrapper.
 *
 * P1-E.23: Added full 4x4 column-major matrix inverse validation utility
 * (validateTransformInvertibility). The primary check remains the 3x3 rotation
 * submatrix determinant (rigid-body check), which is correct under ADR-19.1.
 * The full 4x4 inverse is available as a defensive tool if runtime .hva
 * validation failures are observed with non-rigid-body transforms.
 *
 * Binary format summary:
 *   - 16 bytes: skip (file header)
 *   - 4 bytes: frameCount (uint32)
 *   - 4 bytes: limbCount (uint32)
 *   - 16 * limbCount bytes: limb names (skipped)
 *   - For each frame, for each limb: 12 floats (3x4 row-major matrix)
 *     that are transposed to 16-float column-major with [0,0,0,1] bottom row
 */

// ---------------------------------------------------------------------------
// HvaReader
// ---------------------------------------------------------------------------

/** Reads and parses Westwood HVA voxel animation files.
 *
 * OpenRA 对照: HvaReader class
 *
 * Stores per-frame, per-limb 4x4 transformation matrices in column-major order.
 * Transform array layout: transforms[16 * (limbCount * frame + limb)]
 *   = 16 floats forming a column-major 4x4 matrix.
 */
export class HvaReader {
  /** Number of animation frames.
   *
   * OpenRA 对照: HvaReader.FrameCount
   */
  readonly frameCount: number

  /** Number of limb parts.
   *
   * OpenRA 对照: HvaReader.LimbCount
   */
  readonly limbCount: number

  /** Column-major 4x4 transformation matrices.
   *
   * OpenRA 对照: HvaReader.Transforms
   *
   * Layout: 16 floats per limb per frame.
   * Index: 16 * (limbCount * frame + limb)
   */
  readonly transforms: Float32Array

  // -----------------------------------------------------------------------
  // Static — load from bytes
  // -----------------------------------------------------------------------

  /** Load an HVA file from a byte buffer.
   *
   * OpenRA 对照: HvaReader.Load(string filename)
   *
   * @param data — raw .hva file bytes
   * @param fileName — filename for error messages
   * @returns Parsed HvaReader
   */
  static load(data: Uint8Array, fileName: string): HvaReader {
    const view = new DataView(
      data.buffer,
      data.byteOffset,
      data.byteLength,
    )
    return new HvaReader(view, fileName)
  }

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /** Parse an HVA file from a DataView.
   *
   * OpenRA 对照: HvaReader(Stream s, string fileName)
   *
   * @param s — DataView wrapping the .hva file data
   * @param fileName — filename for error messages
   */
  constructor(s: DataView, _fileName: string) {
    // Index swaps for transposing a row-major matrix to column-major
    // Row-major layout for 3x4: [m00,m01,m02,m03, m10,m11,m12,m13, m20,m21,m22,m23]
    // Column-major target indices (16 floats):
    // Row 0: col 0..3 → indices 0,4,8,12
    // Row 1: col 0..3 → indices 1,5,9,13
    // Row 2: col 0..3 → indices 2,6,10,14
    const ids = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14]

    let offset = 16 // Skip 16-byte header

    this.frameCount = s.getUint32(offset, true)
    offset += 4
    this.limbCount = s.getUint32(offset, true)
    offset += 4

    // Skip limb names
    offset += 16 * this.limbCount

    const totalFloats = 16 * this.frameCount * this.limbCount
    this.transforms = new Float32Array(totalFloats)

    for (let j = 0; j < this.frameCount; j++) {
      for (let i = 0; i < this.limbCount; i++) {
        const c = 16 * (this.limbCount * j + i)

        // Set bottom row of 4x4: [0, 0, 0, 1]
        this.transforms[c + 3] = 0
        this.transforms[c + 7] = 0
        this.transforms[c + 11] = 0
        this.transforms[c + 15] = 1

        // Read 12 floats and transpose into column-major positions
        for (let k = 0; k < 12; k++) {
          this.transforms[c + ids[k]] = s.getFloat32(offset, true)
          offset += 4
        }

        // -------------------------------------------------------------------
        // Validate matrix invertibility (matches C# Util.MatrixInverse check)
        //
        // OpenRA 对照: Util.MatrixInverse(testMatrix) == null check in
        //   HvaReader constructor.
        //
        // Under ADR-19.1, the full 4x4 matrix inverse is unnecessary. We
        // validate using the 3x3 rotation submatrix determinant: a valid
        // rigid-body transform must have |det| ≈ 1 (not 0).
        //
        // If full MatrixInverse parity is ever needed (e.g., runtime .hva
        // validation with non-rigid-body transforms), use the
        // validateTransformInvertibility() static utility which performs
        // a complete 4x4 column-major inverse with cofactor expansion
        // (matching OpenRA's Util.MatrixInverse). See P1-E.23.
        // -------------------------------------------------------------------
        if (HvaReader._isNearSingular3x3(this.transforms, c)) {
          throw new Error(
            `The transformation matrix for HVA file "${_fileName}" section ${i} frame ${j} is invalid because it is not invertible!`,
          )
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Private — 3x3 rotation submatrix determinant check (primary validation)
  // -----------------------------------------------------------------------

  /** Check if a 4x4 column-major rigid-body matrix at offset `c` in `m` is
   * near-singular (non-invertible) via the 3x3 rotation submatrix determinant.
   *
   * OpenRA 对照: Util.MatrixInverse(testMatrix) == null
   *
   * For a rigid-body transform with bottom row [0,0,0,1], only the 3x3 upper-
   * left rotation submatrix determines invertibility. |det| < 1e-6 is
   * considered singular.
   *
   * This is the primary validation path under ADR-19.1.
   */
  private static _isNearSingular3x3(
    m: Float32Array,
    c: number,
  ): boolean {
    // 3x3 column-major submatrix at m[c…c+15]:
    // | m[c+0]  m[c+4]  m[c+8]  |
    // | m[c+1]  m[c+5]  m[c+9]  |
    // | m[c+2]  m[c+6]  m[c+10] |
    const a11 = m[c + 0], a12 = m[c + 4], a13 = m[c + 8]
    const a21 = m[c + 1], a22 = m[c + 5], a23 = m[c + 9]
    const a31 = m[c + 2], a32 = m[c + 6], a33 = m[c + 10]

    const det =
      a11 * (a22 * a33 - a23 * a32) -
      a12 * (a21 * a33 - a23 * a31) +
      a13 * (a21 * a32 - a22 * a31)

    return Math.abs(det) < 1e-6
  }

  // -----------------------------------------------------------------------
  // Static — Full 4x4 matrix inverse validation (P1-E.23, defensive)
  // -----------------------------------------------------------------------

  /** Validate that a 4x4 column-major transform matrix is invertible
   * using a full 4x4 determinant with submatrix cofactor expansion.
   *
   * OpenRA 对照: Util.MatrixInverse(float[] src) (full 4x4 inverse)
   *
   * This is a defensive validation utility. The primary check in the
   * constructor uses the 3x3 rotation submatrix determinant
   * (_isNearSingular3x3), which is correct for rigid-body transforms
   * under ADR-19.1. This method provides full 4x4 parity with the C#
   * MatrixInverse if non-rigid-body transforms are encountered.
   *
   * Column-major layout indices:
   *   | 0  4  8  12 |
   *   | 1  5  9  13 |
   *   | 2  6  10 14 |
   *   | 3  7  11 15 |
   *
   * @param m — Float32Array containing the 16-float column-major matrix
   * @param c — offset into m where the matrix starts
   * @param epsilon — singularity threshold (default 1e-9)
   * @returns true if the matrix is invertible (|det| >= epsilon)
   */
  static validateTransformInvertibility(
    m: Float32Array,
    c: number,
    epsilon: number = 1e-9,
  ): boolean {
    // Extract elements for readability
    // Column 0
    const m00 = m[c + 0], m01 = m[c + 1], m02 = m[c + 2], m03 = m[c + 3]
    // Column 1
    const m10 = m[c + 4], m11 = m[c + 5], m12 = m[c + 6], m13 = m[c + 7]
    // Column 2
    const m20 = m[c + 8], m21 = m[c + 9], m22 = m[c + 10], m23 = m[c + 11]
    // Column 3
    const m30 = m[c + 12], m31 = m[c + 13], m32 = m[c + 14], m33 = m[c + 15]

    // Compute 4x4 determinant via cofactor expansion along first column
    // det = m00*det(minor0) - m01*det(minor1) + m02*det(minor2) - m03*det(minor3)
    const det0 = _det3x3(
      m11, m12, m13,
      m21, m22, m23,
      m31, m32, m33,
    )
    const det1 = _det3x3(
      m10, m12, m13,
      m20, m22, m23,
      m30, m32, m33,
    )
    const det2 = _det3x3(
      m10, m11, m13,
      m20, m21, m23,
      m30, m31, m33,
    )
    const det3 = _det3x3(
      m10, m11, m12,
      m20, m21, m22,
      m30, m31, m32,
    )

    const det4x4 = m00 * det0 - m01 * det1 + m02 * det2 - m03 * det3

    return Math.abs(det4x4) >= epsilon
  }

  // -----------------------------------------------------------------------
  // Utility — get transform for a specific limb/frame
  // -----------------------------------------------------------------------

  /** Get the 4x4 column-major transformation matrix for a specific limb
   * at a specific frame.
   *
   * Returns a new Float32Array(16) that the caller owns.
   *
   * @param limb — limb index (0-based)
   * @param frame — frame index (0-based)
   */
  getTransform(limb: number, frame: number): Float32Array {
    if (frame >= this.frameCount)
      throw new Error(`Only ${this.frameCount} frames exist.`)
    if (limb >= this.limbCount)
      throw new Error(`Only ${this.limbCount} limbs exist.`)

    const c = 16 * (this.limbCount * frame + limb)
    return this.transforms.slice(c, c + 16)
  }
}

// ---------------------------------------------------------------------------
// Internal — 3x3 determinant helper (for 4x4 cofactor expansion)
// ---------------------------------------------------------------------------

/** Compute the determinant of a 3x3 matrix given as row-major elements.
 *
 * @returns det = a(ei - fh) - b(di - fg) + c(dh - eg)
 */
function _det3x3(
  a: number, b: number, c: number,
  d: number, e: number, f: number,
  g: number, h: number, i: number,
): number {
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
}
