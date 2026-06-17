/**
 * FastByteReader.ts — Fast byte-level sequential reader for compressed data
 * OpenRA 对照: OpenRA.Mods.Common/FileFormats/FastByteReader.cs
 *
 * 核心范式转换:
 * - C# class with byte[] + offset pointer → TypeScript class with Uint8Array + index
 * - C# ref semantics → TypeScript mutable index
 *
 * Used by LCWCompression and XORDeltaCompression as an internal helper.
 */

// ---------------------------------------------------------------------------
// FastByteReader
// ---------------------------------------------------------------------------

/** Fast sequential byte reader for decompression algorithms.
 *
 * OpenRA 对照: FastByteReader class
 *
 * Provides ReadByte, ReadWord, and CopyTo operations on a Uint8Array source.
 */
export class FastByteReader {
  private readonly src: Uint8Array
  private _offset: number

  constructor(src: Uint8Array, offset: number = 0) {
    this.src = src
    this._offset = offset
  }

  /** Returns true if all bytes have been consumed.
   *
   * OpenRA 对照: FastByteReader.Done()
   */
  done(): boolean {
    return this._offset >= this.src.length
  }

  /** Read a single byte and advance.
   *
   * OpenRA 对照: FastByteReader.ReadByte()
   */
  readByte(): number {
    return this.src[this._offset++]
  }

  /** Read a little-endian uint16 and advance by 2.
   *
   * OpenRA 对照: FastByteReader.ReadWord()
   */
  readWord(): number {
    const x = this.readByte()
    return x | (this.readByte() << 8)
  }

  /** Copy `count` bytes from current offset to dest at destOffset, then advance.
   *
   * OpenRA 对照: FastByteReader.CopyTo(byte[], int, int)
   */
  copyTo(dest: Uint8Array, destOffset: number, count: number): void {
    dest.set(this.src.subarray(this._offset, this._offset + count), destOffset)
    this._offset += count
  }

  /** Number of bytes remaining.
   *
   * OpenRA 对照: FastByteReader.Remaining()
   */
  remaining(): number {
    return this.src.length - this._offset
  }
}
