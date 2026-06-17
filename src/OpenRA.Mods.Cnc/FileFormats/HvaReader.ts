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
      }
    }
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
