/**
 * Compression.ts — C&C 压缩/解压算法集合
 * OpenRA 对照:
 *   OpenRA.Mods.Common/FileFormats/FastByteReader.cs
 *   OpenRA.Mods.Cnc/FileFormats/LCWCompression.cs
 *   OpenRA.Mods.Cnc/FileFormats/XORDeltaCompression.cs
 *   OpenRA.Mods.Common/FileFormats/RLEZerosCompression.cs
 *
 * 核心范式转换:
 * - C# Stream + FastByteReader(dst, srcOffset) → Uint8Array + offset 游标
 * - C# ref 参数 → 可变状态对象
 * - C# unsafe fixed(byte*) → Uint8Array 索引访问
 * - 所有算法线对线移植自 C#，确保字节级精确输出
 */

// ---------------------------------------------------------------------------
// FastByteReader (对应 OpenRA FastByteReader)
// ---------------------------------------------------------------------------

/**
 * 快速字节读取器，封装 Uint8Array 并提供顺序读取方法。
 *
 * OpenRA 对照: OpenRA.Mods.Common.FileFormats.FastByteReader
 */
export class FastByteReader {
  private readonly src: Uint8Array
  private offset: number

  constructor(src: Uint8Array, offset: number = 0) {
    this.src = src
    this.offset = offset
  }

  /** 是否已读完所有数据。OpenRA 对照: FastByteReader.Done() */
  done(): boolean {
    return this.offset >= this.src.length
  }

  /** 读取一个字节并前进游标。OpenRA 对照: FastByteReader.ReadByte() */
  readByte(): number {
    if (this.offset >= this.src.length) {
      return 0 // C# Stream.ReadByte returns -1 at EOF → effectively 0 in unsigned contexts
    }
    return this.src[this.offset++]!
  }

  /** 读取一个小端序 uint16 并前进游标。OpenRA 对照: FastByteReader.ReadWord() */
  readWord(): number {
    const lo = this.readByte()
    const hi = this.readByte()
    return lo | (hi << 8)
  }

  /** 从源数据复制 count 个字节到目标数组。
   * OpenRA 对照: FastByteReader.CopyTo(byte[], int, int) */
  copyTo(dest: Uint8Array, offset: number, count: number): void {
    dest.set(this.src.subarray(this.offset, this.offset + count), offset)
    this.offset += count
  }

  /** 剩余可读字节数。OpenRA 对照: FastByteReader.Remaining() */
  remaining(): number {
    return this.src.length - this.offset
  }

  /** 获取当前游标位置。 */
  getOffset(): number {
    return this.offset
  }
}

// ---------------------------------------------------------------------------
// LCWCompression (对应 OpenRA LCWCompression)
// ---------------------------------------------------------------------------

/**
 * Lempel-Castle-Welch (Format80) 解压算法。
 *
 * OpenRA 对照: OpenRA.Mods.Cnc.FileFormats.LCWCompression
 *
 * 用于 Tiberian Dawn SHP 精灵格式的帧数据解压。
 * 线对线移植自 C# 实现，保证字节级精确输出。
 */
export class LCWCompression {
  /**
   * 复制缓冲区中之前的字节序列。
   * OpenRA 对照: LCWCompression.ReplicatePrevious
   */
  private static replicatePrevious(
    dest: Uint8Array,
    destIndex: number,
    srcIndex: number,
    count: number,
  ): void {
    if (srcIndex > destIndex) {
      throw new Error(`srcIndex > destIndex ${srcIndex} ${destIndex}`)
    }

    for (let i = 0; i < count; i++) {
      if (destIndex - srcIndex === 1) {
        dest[destIndex + i] = dest[destIndex - 1]!
      } else {
        dest[destIndex + i] = dest[srcIndex + i]!
      }
    }
  }

  /**
   * 将 LCW 压缩数据解码到目标缓冲区。
   *
   * OpenRA 对照: LCWCompression.DecodeInto(byte[], byte[], int, bool)
   *
   * @param src — 源数据（压缩的 LCW 数据）
   * @param dest — 目标缓冲区（解压后数据写入此处）
   * @param srcOffset — 源数据起始偏移量
   * @returns 解压后写入的字节数（destIndex）
   */
  static decodeInto(
    src: Uint8Array,
    dest: Uint8Array,
    srcOffset: number = 0,
  ): number {
    const ctx = new FastByteReader(src, srcOffset)
    let destIndex = 0

    while (true) {
      const i = ctx.readByte()
      if ((i & 0x80) === 0) {
        // case 2
        const secondByte = ctx.readByte()
        const count = ((i & 0x70) >> 4) + 3
        const rpos = ((i & 0x0f) << 8) + secondByte

        if (destIndex + count > dest.length) {
          return destIndex
        }

        LCWCompression.replicatePrevious(dest, destIndex, destIndex - rpos, count)
        destIndex += count
      } else if ((i & 0x40) === 0) {
        // case 1
        const count = i & 0x3f
        if (count === 0) {
          return destIndex
        }

        ctx.copyTo(dest, destIndex, count)
        destIndex += count
      } else {
        const count3 = i & 0x3f
        if (count3 === 0x3e) {
          // case 4
          const count = ctx.readWord()
          const color = ctx.readByte()

          for (let end = destIndex + count; destIndex < end; destIndex++) {
            dest[destIndex] = color
          }
        } else {
          // If count3 == 0x3F it's case 5, else case 3
          const count = count3 === 0x3f ? ctx.readWord() : count3 + 3
          const srcIndex = ctx.readWord()
          if (srcIndex >= destIndex) {
            throw new Error(`srcIndex >= destIndex ${srcIndex} ${destIndex}`)
          }

          let si = srcIndex
          for (let end = destIndex + count; destIndex < end; destIndex++) {
            dest[destIndex] = dest[si++]!
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// XORDeltaCompression (对应 OpenRA XORDeltaCompression)
// ---------------------------------------------------------------------------

/**
 * XOR Delta (Format40) 解压算法。
 *
 * OpenRA 对照: OpenRA.Mods.Cnc.FileFormats.XORDeltaCompression
 *
 * 用于 Tiberian Dawn SHP 帧间 XOR 差分数据解码。
 * 线对线移植自 C# 实现，保证字节级精确输出。
 */
export class XORDeltaCompression {
  /**
   * 将 XOR Delta 压缩数据解码到目标缓冲区（就地 XOR）。
   *
   * OpenRA 对照: XORDeltaCompression.DecodeInto(byte[], byte[], int)
   *
   * @param src — 源数据（XOR Delta 命令流）
   * @param dest — 目标缓冲区（XOR 操作就地应用）
   * @param srcOffset — 源数据起始偏移量
   * @returns 解压后处理的字节数（destIndex）
   */
  static decodeInto(
    src: Uint8Array,
    dest: Uint8Array,
    srcOffset: number,
  ): number {
    const ctx = new FastByteReader(src, srcOffset)
    let destIndex = 0

    while (true) {
      const i = ctx.readByte()
      if ((i & 0x80) === 0) {
        const count = i & 0x7f
        if (count === 0) {
          // case 6
          const count2 = ctx.readByte()
          const value = ctx.readByte()
          for (let end = destIndex + count2; destIndex < end; destIndex++) {
            dest[destIndex] ^= value
          }
        } else {
          // case 5
          for (let end = destIndex + count; destIndex < end; destIndex++) {
            dest[destIndex] ^= ctx.readByte()
          }
        }
      } else {
        const count = i & 0x7f
        if (count === 0) {
          let count2 = ctx.readWord()
          if (count2 === 0) {
            return destIndex
          }

          if ((count2 & 0x8000) === 0) {
            // case 2
            destIndex += count2 & 0x7fff
          } else if ((count2 & 0x4000) === 0) {
            // case 3
            for (
              let end = destIndex + (count2 & 0x3fff);
              destIndex < end;
              destIndex++
            ) {
              dest[destIndex] ^= ctx.readByte()
            }
          } else {
            // case 4
            const value = ctx.readByte()
            for (
              let end = destIndex + (count2 & 0x3fff);
              destIndex < end;
              destIndex++
            ) {
              dest[destIndex] ^= value
            }
          }
        } else {
          // case 1
          destIndex += count
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// RLEZerosCompression (对应 OpenRA RLEZerosCompression)
// ---------------------------------------------------------------------------

/**
 * Run Length Encoded Zeros (Format2) 解压算法。
 *
 * OpenRA 对照: OpenRA.Mods.Common.FileFormats.RLEZerosCompression
 *
 * 零字节行程编码: 0x00 后跟 count → count 个零字节,
 * 非零字节 → 直接复制。
 */
export class RLEZerosCompression {
  /**
   * 将 RLE Zeros 压缩数据解码到目标缓冲区。
   *
   * OpenRA 对照: RLEZerosCompression.DecodeInto(byte[], byte[], int)
   *
   * @param src — 源数据（RLE Zeros 命令流）
   * @param dest — 目标缓冲区
   * @param destIndex — 目标缓冲区起始偏移量
   */
  static decodeInto(
    src: Uint8Array,
    dest: Uint8Array,
    destIndex: number,
  ): void {
    const r = new FastByteReader(src)

    while (!r.done()) {
      const cmd = r.readByte()
      if (cmd === 0) {
        const count = r.readByte()
        dest.fill(0, destIndex, destIndex + count)
        destIndex += count
      } else {
        dest[destIndex++] = cmd
      }
    }
  }
}
