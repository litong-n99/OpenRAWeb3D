/**
 * BlowfishKeyProvider.ts — Blowfish key derivation from game EXE
 * OpenRA 对照: OpenRA.Mods.Cnc/FileFormats/BlowfishKeyProvider.cs
 *
 * 核心范式转换:
 * - C# unsafe byte* pointer arithmetic → TypeScript Uint32Array index math
 * - C# fixed buffers + ushort* casts → manual uint16 extraction from Uint32Array
 * - C# Array.Copy / Skip / ToArray → Uint32Array.subarray / set
 * - C# Convert.FromBase64String → browser-compatible base64 decode
 *
 * This class analyzes a game executable binary to extract the Blowfish
 * encryption key used for encrypted game assets (MIX files, etc.).
 *
 * The algorithm uses big-integer arithmetic (RSA-like modular exponentiation)
 * to decrypt a public key, then derives the final 56-byte Blowfish key.
 * All big-int operations use arrays of uint32 (64 limbs max).
 *
 * NOTE: This is a pure-algorithm port. The C# implementation is a direct
 * port of legacy C code and is not particularly readable.
 *
 * The public key is hardcoded as a base64 string, consistent with OpenRA.
 *
 * Used at asset-load time (build time). Runtime can use hardcoded keys.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Public key string (base64-encoded) — hardcoded from C# source.
 *
 * OpenRA 对照: BlowfishKeyProvider.PublicKeyString
 */
const PUBLIC_KEY_STRING = 'AihRvNoIbTn85FZRYNZRcT+i6KpU+maCsEqr3Q5q+LDB5tH7Tz2qQ38V'

/** Maximum limb count for big-int arrays. */
const MAX_LIMBS = 64

// ---------------------------------------------------------------------------
// BlowfishKeyProvider
// ---------------------------------------------------------------------------

/** Extracts a Blowfish key from a game EXE binary.
 *
 * OpenRA 对照: BlowfishKeyProvider class
 *
 * The workflow:
 * 1. InitPublicKey() — decode the hardcoded base64 public key into big-int form
 * 2. DecryptKey(byte[] src) — process the input EXE data to derive the 56-byte key
 */
export class BlowfishKeyProvider {
  // -----------------------------------------------------------------------
  // PublicKey equivalent
  // -----------------------------------------------------------------------

  private readonly pubKeyOne = new Uint32Array(MAX_LIMBS)
  private readonly pubKeyTwo = new Uint32Array(MAX_LIMBS)
  private pubKeyLen: number = 0

  // -----------------------------------------------------------------------
  // Working state
  // -----------------------------------------------------------------------

  private readonly globOne = new Uint32Array(MAX_LIMBS)
  private globOneBitLen: number = 0
  private globOneLenXTwo: number = 0
  private readonly globTwo = new Uint32Array(130)
  private readonly globOneHigh = new Uint32Array(4)
  private readonly globOneHighInv = new Uint32Array(4)
  private globOneHighBitLen: number = 0
  private globOneHighInvLow: number = 0
  private globOneHighInvHigh: number = 0

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Derive a 56-byte Blowfish key from input data.
   *
   * OpenRA 对照: BlowfishKeyProvider.DecryptKey(byte[])
   *
   * This is the main entry point. It initializes the public key from
   * the hardcoded base64 string, then processes the input (typically
   * game EXE data) through RSA-like modular exponentiation, producing
   * a 56-byte key suitable for initializing `Blowfish`.
   *
   * @param src — input data (game EXE or portion thereof)
   * @returns 56-byte Blowfish key
   */
  decryptKey(src: Uint8Array): Uint8Array {
    this._initPublicKey()
    return this._processPredata(src)
  }

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------

  /**
   * Initialize public key from hardcoded base64 string.
   *
   * OpenRA 对照: BlowfishKeyProvider.InitPublicKey()
   */
  private _initPublicKey(): void {
    // Initialize KeyTwo = 0x10001 (RSA-like exponent 65537)
    _initBigNum(this.pubKeyTwo, 0x10001, MAX_LIMBS)

    // Decode base64 public key string into KeyOne
    const keyBytes = _base64Decode(PUBLIC_KEY_STRING)
    _keyToBigNum(this.pubKeyOne, keyBytes, MAX_LIMBS, MAX_LIMBS)
    this.pubKeyLen = _bitLenBigNum(this.pubKeyOne, MAX_LIMBS) - 1
  }

  // -----------------------------------------------------------------------
  // Core key derivation
  // -----------------------------------------------------------------------

  /**
   * Process predicate data to derive the final key.
   *
   * OpenRA 对照: BlowfishKeyProvider.ProcessPredata(byte[])
   */
  private _processPredata(src: Uint8Array): Uint8Array {
    const dest = new Uint8Array(256)
    const n2 = new Uint32Array(MAX_LIMBS)
    const n3 = new Uint32Array(MAX_LIMBS)

    const a = Math.floor((this.pubKeyLen - 1) / 8)
    let preLen = (Math.floor(55 / a) + 1) * (a + 1)
    let srcOffset = 0
    let destOffset = 0

    while (a + 1 <= preLen) {
      _initBigNum(n2, 0, MAX_LIMBS)

      // Buffer.BlockCopy: copy (a+1) bytes from src at srcOffset to n2 at offset 0
      _copyBytesToUint32Array(src, srcOffset, n2, 0, a + 1)

      this._calcKey(n3, n2, this.pubKeyTwo, this.pubKeyOne, MAX_LIMBS)
      // Buffer.BlockCopy: copy `a` bytes from n3 to dest
      _copyUint32ArrayToBytes(n3, 0, dest, destOffset, a)

      preLen -= a + 1
      srcOffset += a + 1
      destOffset += a
    }

    return dest.slice(0, 56)
  }

  // -----------------------------------------------------------------------
  // Big integer operations (private methods)
  // -----------------------------------------------------------------------

  /**
   * RSA modular exponentiation: n1 = n2^exponent mod n4.
   *
   * OpenRA 对照: BlowfishKeyProvider.CalcKey(uint[], uint[], uint[], uint[], uint)
   */
  private _calcKey(
    n1: Uint32Array,
    n2: Uint32Array,
    n3: Uint32Array,
    n4: Uint32Array,
    len: number,
  ): void {
    const nTmp = new Uint32Array(MAX_LIMBS)

    _initBigNum(n1, 1, len)
    const n4Len = _lenBigNum(n4, len)
    this._initTwoDw(n4, n4Len)
    let n3BitLen = _bitLenBigNum(n3, n4Len)
    let n3Len = Math.floor((n3BitLen + 31) / 32)
    let bitMask = (1 << ((n3BitLen - 1) % 32)) >> 1
    let pn3Idx = n3Len - 1
    n3BitLen--
    _moveBigNum(n1, n2, n4Len)

    while (--n3BitLen !== -1) {
      if (bitMask === 0) {
        bitMask = 0x80000000
        pn3Idx--
      }

      this._calcBigNum(nTmp, n1, n1, n4Len)
      if ((n3[pn3Idx] & bitMask) !== 0) {
        this._calcBigNum(n1, nTmp, n2, n4Len)
      } else {
        _moveBigNum(n1, nTmp, n4Len)
      }
      bitMask >>>= 1
    }

    _initBigNum(nTmp, 0, n4Len)
    this._clearTempVars(len)
  }

  /**
   * Modular multiplication: n1 = n2 * n3 mod globOne.
   *
   * OpenRA 对照: BlowfishKeyProvider.CalcBigNum(uint[], uint[], uint[], uint)
   */
  private _calcBigNum(
    n1: Uint32Array,
    n2: Uint32Array,
    n3: Uint32Array,
    len: number,
  ): void {
    _mulBigNum(this.globTwo, n2, n3, len)
    this.globTwo[len * 2] = 0
    const globTwoXtwo = _lenBigNum(this.globTwo, len * 2 + 1) * 2

    if (globTwoXtwo >= this.globOneLenXTwo) {
      _incrementBigNum(this.globTwo, len * 2 + 1)
      _negBigNum(this.globTwo, len * 2 + 1)
      let lenDiff = globTwoXtwo + 1 - this.globOneLenXTwo

      let esiOffset = 1 + globTwoXtwo - this.globOneLenXTwo
      let ediOffset = globTwoXtwo + 1

      for (; lenDiff !== 0; lenDiff--) {
        ediOffset--
        const ediVal = _getUshortFromUint32Array(this.globTwo, ediOffset)
        const tmp = this._getMulWord(ediVal, ediOffset)
        esiOffset--

        if (tmp > 0) {
          _mulBigNumWord(this.globTwo, esiOffset, this.globOne, tmp, 2 * len)
          // Check if edi bit 15 is clear after subtract
          if ((ediVal & 0x8000) === 0) {
            const carry = _subBigNum(
              this.globTwo, esiOffset,
              this.globTwo, esiOffset,
              this.globOne, 0,
              0, len,
            )
            if (carry !== 0) {
              this.globTwo[Math.floor(ediOffset / 2)]--
            }
          }
        }
      }

      _negBigNum(this.globTwo, len)
      _decBigNum(this.globTwo, len)
    }

    _moveBigNum(n1, this.globTwo, len)
  }

  /**
   * Initialize the two-DW (division working) state.
   *
   * OpenRA 对照: BlowfishKeyProvider.InitTwoDw(uint[], uint)
   */
  private _initTwoDw(n: Uint32Array, len: number): void {
    _moveBigNum(this.globOne, n, len)
    this.globOneBitLen = _bitLenBigNum(this.globOne, len)
    this.globOneLenXTwo = Math.floor((this.globOneBitLen + 15) / 16)

    // Copy last 2 limbs of globOne to globOneHigh
    const globOneLen = _lenBigNum(this.globOne, len)
    this.globOneHigh[0] = globOneLen >= 2 ? this.globOne[globOneLen - 2] : 0
    this.globOneHigh[1] = globOneLen >= 1 ? this.globOne[globOneLen - 1] : 0
    this.globOneHigh[2] = 0
    this.globOneHigh[3] = 0

    this.globOneHighBitLen = _bitLenBigNum(this.globOneHigh, 2) - 32
    _shrBigNum(this.globOneHigh, this.globOneHighBitLen, 2)
    _invertBigNum(this.globOneHighInv, this.globOneHigh, 2)
    _shrBigNum(this.globOneHighInv, 1, 2)
    this.globOneHighBitLen = ((this.globOneHighBitLen + 15) % 16) + 1
    _incrementBigNum(this.globOneHighInv, 2)

    if (_bitLenBigNum(this.globOneHighInv, 2) > 32) {
      _shrBigNum(this.globOneHighInv, 1, 2)
      this.globOneHighBitLen--
    }

    this.globOneHighInvLow = this.globOneHighInv[0] & 0xffff
    this.globOneHighInvHigh = (this.globOneHighInv[0] >> 16) & 0xffff
  }

  /**
   * Get multiplication word for modular reduction.
   *
   * OpenRA 对照: BlowfishKeyProvider.GetMulWord(uint* n)
   *
   * Complex formula combining globOneHighInv with complement of operand word.
   */
  private _getMulWord(_ptr: number, byteOffset: number): number {
    // byteOffset is in ushort units (each 2 bytes)
    const wn = byteOffset & 0xffff
    const wnMinus1 = (byteOffset >= 1) ? _getUshortFromUint32Array(this.globTwo, byteOffset - 1) : 0
    const wnMinus2 = (byteOffset >= 2) ? _getUshortFromUint32Array(this.globTwo, byteOffset - 2) : 0

    // Break down the complex C# formula into steps for readability
    const invLow = this.globOneHighInvLow
    const invHigh = this.globOneHighInvHigh

    const a = ((wnMinus1 ^ 0xffff) & 0xffff) * invLow + 0x10000
    const aShifted = a >>> 1

    const b = (wnMinus2 ^ 0xffff) * invHigh + invHigh
    const bShifted = b >>> 1

    const c = aShifted + bShifted + 1
    const cShifted = c >>> 16

    const d = ((wnMinus1 ^ 0xffff) & 0xffff) * invHigh
    const dShifted = d >>> 1

    const e = (wn ^ 0xffff) * invLow
    const eShifted = e >>> 1

    const f = cShifted + dShifted + eShifted + 1
    const fShifted = f >>> 14

    const g = fShifted + invHigh * (wn ^ 0xffff) * 2
    let i = g >>> this.globOneHighBitLen

    if (i > 0xffff) i = 0xffff
    return i & 0xffff
  }

  /**
   * Clear temporary working variables.
   *
   * OpenRA 对照: BlowfishKeyProvider.ClearTempVars(uint)
   */
  private _clearTempVars(_len: number): void {
    this.globOne.fill(0)
    this.globTwo.fill(0)
    this.globOneHighInv.fill(0)
    this.globOneHigh.fill(0)
    this.globOneBitLen = 0
    this.globOneHighBitLen = 0
    this.globOneLenXTwo = 0
    this.globOneHighInvLow = 0
    this.globOneHighInvHigh = 0
  }
}

// ===========================================================================
// Big-Integer Utility Functions (static, mirror C# static methods)
// ===========================================================================

/**
 * Initialize a big-int array to a scalar value.
 *
 * OpenRA 对照: InitBigNum(uint[], uint, uint)
 */
function _initBigNum(n: Uint32Array, val: number, len: number): void {
  n.fill(0, 0, len)
  n[0] = val >>> 0
}

/**
 * Copy a byte array into a Uint32Array (big-endian byte order, sign extended).
 *
 * OpenRA 对照: MoveKeyToBig(uint[], byte[], uint, uint)
 */
function _moveKeyToBig(n: Uint32Array, key: Uint8Array, klen: number, blen: number): void {
  const sign = (key[0] & 0x80) !== 0 ? 0xff : 0
  const totalBytes = blen * 4
  const n8 = new Uint8Array(n.buffer, n.byteOffset, totalBytes)

  let i = totalBytes
  for (; i > klen; i--) n8[i - 1] = sign
  for (; i > 0; i--) n8[i - 1] = key[klen - i]
}

/**
 * Parse a DER-encoded RSA public key into a big-int array.
 *
 * OpenRA 对照: KeyToBigNum(uint[], byte[], uint)
 */
function _keyToBigNum(n: Uint32Array, key: Uint8Array, len: number, maxLen: number): void {
  let j = 0

  if (key[j] !== 2) return
  j++

  let keylen: number
  if ((key[j] & 0x80) !== 0) {
    keylen = 0
    const count = key[j] & 0x7f
    for (let i = 0; i < count; i++) keylen = (keylen << 8) | key[j + i + 1]
    j += count + 1
  } else {
    keylen = key[j]
    j++
  }

  if (keylen <= len * 4) {
    _moveKeyToBig(n, key.subarray(j), keylen, maxLen)
  }
}

/**
 * Get the length (in uint32 limbs) of a big-int, stopping at the highest non-zero limb.
 *
 * OpenRA 对照: LenBigNum(uint[], uint)
 */
function _lenBigNum(n: Uint32Array, len: number): number {
  if (len === 0) return 0
  let i = len
  while (n[--i] === 0) {
    if (i === 0) return 0
  }
  return i + 1
}

/**
 * Get the bit length of a big-int.
 *
 * OpenRA 对照: BitLenBigNum(uint[], uint)
 */
function _bitLenBigNum(n: Uint32Array, len: number): number {
  const ddlen = _lenBigNum(n, len)
  if (ddlen === 0) return 0
  let bitlen = ddlen * 32
  let mask = 0x80000000
  while ((mask & n[ddlen - 1]) === 0) {
    mask >>>= 1
    bitlen--
  }
  return bitlen
}

/**
 * Compare two big-ints.
 *
 * OpenRA 对照: CompareBigNum(uint[], uint[], uint)
 *
 * @returns -1 if n1 < n2, 0 if equal, 1 if n1 > n2
 */
function _compareBigNum(n1: Uint32Array, n2: Uint32Array, len: number): number {
  while (len > 0) {
    --len
    if (n1[len] < n2[len]) return -1
    if (n1[len] > n2[len]) return 1
  }
  return 0
}

/**
 * Copy a big-int: dest = src (first len elements).
 *
 * OpenRA 对照: MoveBigNum(uint[], uint[], uint)
 */
function _moveBigNum(dest: Uint32Array, src: Uint32Array, len: number): void {
  dest.set(src.subarray(0, len))
}

/**
 * Shift a big-int right by `bits` positions.
 *
 * OpenRA 对照: ShrBigNum(uint[], int, int)
 */
function _shrBigNum(n: Uint32Array, bits: number, len: number): void {
  let i: number
  const i2 = Math.floor(bits / 32)

  if (i2 > 0) {
    for (i = 0; i < len - i2; i++) n[i] = n[i + i2]
    for (; i < len; i++) n[i] = 0
    bits %= 32
  }

  if (bits === 0) return
  for (i = 0; i < len - 1; i++) {
    n[i] = ((n[i] >>> bits) | (n[i + 1] << (32 - bits))) >>> 0
  }
  n[i] = n[i] >>> bits
}

/**
 * Shift a big-int left by `bits` positions.
 *
 * OpenRA 对照: ShlBigNum(uint[], int, int)
 */
function _shlBigNum(n: Uint32Array, bits: number, len: number): void {
  let i: number
  let i2 = Math.floor(bits / 32)

  if (i2 > 0) {
    for (i = len - 1; i >= i2; i--) n[i] = n[i - i2]
    for (; i >= 0; i--) n[i] = 0
    bits %= 32
  }

  if (bits === 0) return
  for (i = len - 1; i > 0; i--) {
    n[i] = ((n[i] << bits) | (n[i - 1] >>> (32 - bits))) >>> 0
  }
  n[0] = (n[0] << bits) >>> 0
}

/**
 * Subtract two big-ints via 16-bit chunks: dest = src1 - src2 - carry.
 *
 * OpenRA 对照: SubBigNum(uint[], uint[], uint[], uint, int)
 *
 * @returns carry out (1 if borrow, 0 otherwise)
 */
function _subBigNum(
  dest: Uint32Array, destOffset: number,
  src1: Uint32Array, src1Offset: number,
  src2: Uint32Array, _src2Offset: number,
  carry: number,
  len: number,
): number {
  let totalLen = len * 2 // working in 16-bit units

  let dOff = destOffset * 2
  let s1Off = src1Offset * 2
  let s2Off = 0

  while (--totalLen !== -1) {
    const i1 = _getUshortFromUint32Array(src1, s1Off++)
    const i2 = _getUshortFromUint32Array(src2, s2Off++)
    const diff = i1 - i2 - carry
    _setUshortInUint32Array(dest, dOff++, diff & 0xffff)
    if ((diff & 0x10000) !== 0) carry = 1; else carry = 0
  }

  return carry
}

/**
 * Modular inverse: n1 = n2^(-1) mod 2^(len*32).
 *
 * OpenRA 对照: InvertBigNum(uint[], uint[], uint)
 */
function _invertBigNum(n1: Uint32Array, n2: Uint32Array, len: number): void {
  const nTmp = new Uint32Array(MAX_LIMBS)

  _initBigNum(nTmp, 0, len)
  _initBigNum(n1, 0, len)
  let nTwoBitLen = _bitLenBigNum(n2, len)
  let bit = 1 << (nTwoBitLen % 32)
  let j = Math.floor((nTwoBitLen + 32) / 32) - 1
  const nTwoByteLen = Math.floor((nTwoBitLen - 1) / 32) * 4
  nTmp[Math.floor(nTwoByteLen / 4)] |= 1 << ((nTwoBitLen - 1) & 0x1f)

  while (nTwoBitLen > 0) {
    nTwoBitLen--
    _shlBigNum(nTmp, 1, len)
    if (_compareBigNum(nTmp, n2, len) !== -1) {
      _subBigNum(nTmp, 0, nTmp, 0, n2, 0, 0, len)
      n1[j] |= bit
    }
    bit >>>= 1
    if (bit === 0) {
      j--
      bit = 0x80000000
    }
  }

  _initBigNum(nTmp, 0, len)
}

/**
 * Increment a big-int by 1.
 *
 * OpenRA 对照: IncrementBigNum(uint[], uint)
 */
function _incrementBigNum(n: Uint32Array, len: number): void {
  let i = 0
  while (i < len) {
    n[i] = ((n[i] + 1) >>> 0)
    if (n[i] !== 0) break
    i++
  }
}

/**
 * Decrement a big-int by 1.
 *
 * OpenRA 对照: DecBigNum(uint[], uint)
 */
function _decBigNum(n: Uint32Array, len: number): void {
  let i = 0
  while (i < len) {
    n[i] = ((n[i] - 1) >>> 0)
    if (n[i] !== 0xffffffff) break
    i++
  }
}

/**
 * Bitwise NOT on a big-int.
 *
 * OpenRA 对照: NotBigNum(uint[], uint)
 */
function _notBigNum(n: Uint32Array, len: number): void {
  for (let i = 0; i < len; i++) n[i] = (~n[i]) >>> 0
}

/**
 * Negate a big-int (two's complement).
 *
 * OpenRA 对照: NegBigNum(uint[], uint)
 */
function _negBigNum(n: Uint32Array, len: number): void {
  _notBigNum(n, len)
  _incrementBigNum(n, len)
}

/**
 * Multiply two big-ints: dest = src1 * src2.
 *
 * OpenRA 对照: MulBigNum(uint[], uint[], uint[], uint)
 */
function _mulBigNum(dest: Uint32Array, src1: Uint32Array, src2: Uint32Array, len: number): void {
  _initBigNum(dest, 0, len * 2)
  for (let i = 0; i < len * 2; i++) {
    _mulBigNumWord(dest, i, src1, _getUshortFromUint32Array(src2, i), len * 2)
  }
}

/**
 * Multiply-accumulate: dest[offset..] += src * mul.
 *
 * OpenRA 对照: MulBignumWord(ushort* pn1, uint[] n2, uint mul, uint len)
 *
 * Operates on 16-bit units (ushort* in C#).
 */
function _mulBigNumWord(
  dest: Uint32Array,
  destUshortOffset: number,
  src: Uint32Array,
  mul: number,
  len: number,
): void {
  let tmp = 0
  for (let i = 0; i < len; i++) {
    const srcVal = _getUshortFromUint32Array(src, i)
    const destVal = _getUshortFromUint32Array(dest, destUshortOffset + i)
    tmp = mul * srcVal + destVal + tmp
    _setUshortInUint32Array(dest, destUshortOffset + i, tmp & 0xffff)
    tmp >>>= 16
  }
  const existing = _getUshortFromUint32Array(dest, destUshortOffset + len)
  _setUshortInUint32Array(dest, destUshortOffset + len, (existing + (tmp & 0xffff)) & 0xffff)
}

// ---------------------------------------------------------------------------
// Uint32Array <-> byte array conversion helpers
// ---------------------------------------------------------------------------

/**
 * Copy bytes from a Uint8Array into a Uint32Array (as if via Buffer.BlockCopy).
 */
function _copyBytesToUint32Array(
  src: Uint8Array,
  srcOffset: number,
  dest: Uint32Array,
  destIdx: number,
  count: number,
): void {
  // Copy byte-by-byte into the uint32 array's byte representation
  const dest8 = new Uint8Array(dest.buffer, dest.byteOffset, dest.byteLength)
  for (let i = 0; i < count; i++) {
    dest8[destIdx * 4 + i] = src[srcOffset + i]
  }
}

/**
 * Copy bytes from a Uint32Array into a Uint8Array.
 */
function _copyUint32ArrayToBytes(
  src: Uint32Array,
  srcIdx: number,
  dest: Uint8Array,
  destOffset: number,
  count: number,
): void {
  const src8 = new Uint8Array(src.buffer, src.byteOffset, src.byteLength)
  for (let i = 0; i < count; i++) {
    dest[destOffset + i] = src8[srcIdx * 4 + i]
  }
}

/**
 * Get a ushort (uint16) from a Uint32Array at a given ushort offset.
 *
 * C# equivalent: array is uint[] but accessed as ushort*.
 * Each uint32 contains 2 ushorts (low word at even offset, high word at odd).
 */
function _getUshortFromUint32Array(arr: Uint32Array, ushortOffset: number): number {
  const limbIdx = Math.floor(ushortOffset / 2)
  if ((ushortOffset & 1) === 0) {
    return arr[limbIdx] & 0xffff
  } else {
    return (arr[limbIdx] >>> 16) & 0xffff
  }
}

/**
 * Set a ushort (uint16) into a Uint32Array at a given ushort offset.
 */
function _setUshortInUint32Array(arr: Uint32Array, ushortOffset: number, value: number): void {
  const limbIdx = Math.floor(ushortOffset / 2)
  const val16 = value & 0xffff
  if ((ushortOffset & 1) === 0) {
    arr[limbIdx] = (arr[limbIdx] & 0xffff0000) | val16
  } else {
    arr[limbIdx] = (arr[limbIdx] & 0x0000ffff) | (val16 << 16)
  }
}

// ---------------------------------------------------------------------------
// Base64 decode (browser-compatible)
// ---------------------------------------------------------------------------

/**
 * Decode a base64 string to Uint8Array.
 *
 * OpenRA 对照: Convert.FromBase64String(string)
 *
 * Uses btoa/atob for browser compatibility, or manual implementation.
 */
function _base64Decode(str: string): Uint8Array {
  // Use standard browser/Node base64
  const binaryStr = atob(str)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i)
  }
  return bytes
}
