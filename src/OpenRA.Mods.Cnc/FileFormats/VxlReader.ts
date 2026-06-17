/**
 * VxlReader.ts — Westwood VXL voxel file format reader
 * OpenRA 对照: OpenRA.Mods.Cnc/FileFormats/VxlReader.cs
 *
 * 核心范式转换:
 * - C# Stream + BinaryReader → TypeScript DataView on Uint8Array
 * - C# Stream.Seek() → DataView byteOffset tracking
 * - C# Dictionary<byte, VxlElement> VoxelMap[:,] → TypeScript Map<number, VxlElement>[][]
 *
 * ADR-19.1 Impact:
 * - Used as a build-time format reader for .vxl→.glb conversion.
 * - At runtime, this serves as a thin validation wrapper (can verify .glb
 *   was generated from the correct .vxl).
 * - The original C# software rasterizer that consumed VxlLimb data is
 *   replaced by pre-converted glTF meshes.
 *
 * Binary format summary:
 *   - Header: "Voxel Animation\0" (16 bytes ASCII)
 *   - 4 bytes: unknown uint32
 *   - 4 bytes: limbCount (uint32)
 *   - 4 bytes: unknown uint32
 *   - 4 bytes: bodySize (uint32)
 *   - 770 bytes: skipped (unknown padding)
 *   - Limb headers (28 bytes each): name (16 bytes) + skip (12 bytes)
 *   - Skip to offset 802 + 28*limbCount + bodySize
 *   - Limb footers (64 bytes each): dataOffset, scale, bounds, size, normalType
 *   - Voxel data: sparse column encoding with run-length compression
 */

// ---------------------------------------------------------------------------
// NormalType enum
// ---------------------------------------------------------------------------

/** Normal encoding type for voxel models.
 *
 * OpenRA 对照: NormalType : byte { TiberianSun = 2, RedAlert2 = 4 }
 *
 * NOTE: Using const object + type union instead of TypeScript enum
 * to satisfy erasableSyntaxOnly (TypeScript ~6.0).
 */
export const NormalType = {
  TiberianSun: 2,
  RedAlert2: 4,
} as const
export type NormalType = (typeof NormalType)[keyof typeof NormalType]

// ---------------------------------------------------------------------------
// VxlElement — single voxel element
// ---------------------------------------------------------------------------

/** A single voxel element with color index and normal index.
 *
 * OpenRA 对照: VxlElement(byte Color, byte Normal)
 */
export interface VxlElement {
  /** Palette color index for this voxel.
   *
   * OpenRA 对照: VxlElement.Color
   */
  color: number

  /** Normal vector index for this voxel (0–255).
   *
   * OpenRA 对照: VxlElement.Normal
   */
  normal: number
}

// ---------------------------------------------------------------------------
// VxlLimb — a single limb of a voxel model
// ---------------------------------------------------------------------------

/** Represents one limb (part) of a voxel model.
 *
 * OpenRA 对照: VxlLimb class
 */
export class VxlLimb {
  /** Limb name (16 bytes ASCII, null-terminated).
   *
   * OpenRA 对照: VxlLimb.Name
   */
  name = ''

  /** Scale factor for this limb.
   *
   * OpenRA 对照: VxlLimb.Scale
   */
  scale = 0

  /** Bounding box: [minX, minY, minZ, maxX, maxY, maxZ].
   *
   * OpenRA 对照: VxlLimb.Bounds
   */
  bounds = new Float32Array(6)

  /** Limb dimensions: [sizeX, sizeY, sizeZ].
   *
   * OpenRA 对照: VxlLimb.Size
   */
  size = new Uint8Array(3)

  /** Normal type for this limb.
   *
   * OpenRA 对照: VxlLimb.Type
   */
  type: NormalType = NormalType.TiberianSun

  /** Total number of non-empty voxels in this limb.
   *
   * OpenRA 对照: VxlLimb.VoxelCount
   */
  voxelCount = 0

  /** Sparse voxel map: [x][y] → Map<z, VxlElement>.
   *
   * OpenRA 对照: VxlLimb.VoxelMap (Dictionary<byte, VxlElement>[,])
   */
  voxelMap: Map<number, VxlElement>[][] = []
}

// ---------------------------------------------------------------------------
// VxlReader
// ---------------------------------------------------------------------------

/** Reads and parses Westwood VXL voxel model files.
 *
 * OpenRA 对照: VxlReader class
 */
export class VxlReader {
  readonly limbCount: number
  readonly limbs: VxlLimb[]

  private readonly bodySize: number

  // -----------------------------------------------------------------------
  // Static — load from bytes
  // -----------------------------------------------------------------------

  /** Load a VXL file from a byte buffer.
   *
   * OpenRA 对照: VxlReader.Load(string filename)
   *
   * @param data — raw .vxl file bytes
   * @returns Parsed VxlReader
   */
  static load(data: Uint8Array): VxlReader {
    const view = new DataView(
      data.buffer,
      data.byteOffset,
      data.byteLength,
    )
    return new VxlReader(view)
  }

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /** Parse a VXL file from a DataView.
   *
   * OpenRA 对照: VxlReader(Stream s)
   *
   * @param s — DataView wrapping the .vxl file data
   */
  constructor(s: DataView) {
    let offset = 0

    // Read and validate header
    const header = VxlReader._readASCII(s, offset, 16)
    offset += 16
    if (!header.startsWith('Voxel Animation'))
      throw new Error(`Invalid vxl header: "${header}"`)

    // Skip unknown uint32
    offset += 4

    this.limbCount = s.getUint32(offset, true)
    offset += 4

    // Skip unknown uint32
    offset += 4

    this.bodySize = s.getUint32(offset, true)
    offset += 4

    // Skip 770 bytes
    offset += 770

    // Read limb headers
    this.limbs = new Array<VxlLimb>(this.limbCount)
    for (let i = 0; i < this.limbCount; i++) {
      const limb = new VxlLimb()
      limb.name = VxlReader._readASCII(s, offset, 16).replace(/\0/g, '')
      offset += 16
      // Skip 12 bytes
      offset += 12
      this.limbs[i] = limb
    }

    // Skip to limb footers
    offset = 802 + 28 * this.limbCount + this.bodySize

    // Read limb footers
    const limbDataOffset = new Array<number>(this.limbCount)
    for (let i = 0; i < this.limbCount; i++) {
      limbDataOffset[i] = s.getUint32(offset, true)
      offset += 4
      // Skip 8 bytes
      offset += 8
      this.limbs[i].scale = s.getFloat32(offset, true)
      offset += 4
      // Skip 48 bytes
      offset += 48

      this.limbs[i].bounds = new Float32Array(6)
      for (let j = 0; j < 6; j++) {
        this.limbs[i].bounds[j] = s.getFloat32(offset, true)
        offset += 4
      }
      // Read size (3 bytes)
      this.limbs[i].size[0] = s.getUint8(offset)
      this.limbs[i].size[1] = s.getUint8(offset + 1)
      this.limbs[i].size[2] = s.getUint8(offset + 2)
      offset += 3
      this.limbs[i].type = s.getUint8(offset) as NormalType
      offset += 1
    }

    // Read voxel data for each limb
    for (let i = 0; i < this.limbCount; i++) {
      offset = 802 + 28 * this.limbCount + limbDataOffset[i]
      VxlReader._readVoxelData(s, offset, this.limbs[i])
    }
  }

  // -----------------------------------------------------------------------
  // Private — read voxel data for one limb
  // -----------------------------------------------------------------------

  /** Read sparse voxel column data for a limb.
   *
   * OpenRA 对照: ReadVoxelData(Stream s, VxlLimb l)
   */
  private static _readVoxelData(
    s: DataView,
    dataOffset: number,
    l: VxlLimb,
  ): void {
    const baseSize = l.size[0] * l.size[1]
    const colStart = new Int32Array(baseSize)

    // Read column start offsets
    let offset = dataOffset
    for (let i = 0; i < baseSize; i++) {
      colStart[i] = s.getInt32(offset, true)
      offset += 4
    }
    // Skip second copy of colStart
    offset += 4 * baseSize
    const dataStart = offset

    // Count voxels in this limb
    l.voxelCount = 0
    for (let i = 0; i < baseSize; i++) {
      if (colStart[i] === -1) continue

      offset = dataStart + colStart[i]
      let z = 0
      do {
        z += s.getUint8(offset)
        offset += 1
        const count = s.getUint8(offset)
        offset += 1
        z += count
        l.voxelCount += count
        // Skip voxel data (2 bytes per voxel: color + normal) + duplicate count (1 byte)
        offset += 2 * count + 1
      } while (z < l.size[2])
    }

    // Read the voxel data
    l.voxelMap = new Array(l.size[0])
    for (let x = 0; x < l.size[0]; x++) {
      l.voxelMap[x] = new Array(l.size[1])
      for (let y = 0; y < l.size[1]; y++) {
        l.voxelMap[x][y] = new Map<number, VxlElement>()
      }
    }

    for (let i = 0; i < baseSize; i++) {
      if (colStart[i] === -1) continue

      offset = dataStart + colStart[i]

      const x = i % l.size[0]
      const y = Math.floor(i / l.size[0])
      let z = 0
      const voxelMap = l.voxelMap[x][y]

      do {
        z += s.getUint8(offset)
        offset += 1
        const count = s.getUint8(offset)
        offset += 1

        for (let j = 0; j < count; j++) {
          const color = s.getUint8(offset)
          offset += 1
          const normal = s.getUint8(offset)
          offset += 1
          voxelMap.set(z, { color, normal })
          z++
        }

        // Skip duplicate count byte
        offset += 1
      } while (z < l.size[2])
    }
  }

  // -----------------------------------------------------------------------
  // Private — utility
  // -----------------------------------------------------------------------

  /** Read ASCII string from a DataView at a specific offset.
   *
   * OpenRA 对照: Stream.ReadASCII(int) extension
   */
  private static _readASCII(
    s: DataView,
    offset: number,
    length: number,
  ): string {
    let str = ''
    for (let i = 0; i < length; i++) {
      const byte = s.getUint8(offset + i)
      if (byte === 0) break
      str += String.fromCharCode(byte)
    }
    return str
  }
}
