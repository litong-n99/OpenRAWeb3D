/**
 * Sha1Verifier.ts — SHA1 hash computation and verification using the
 * Web Crypto API (SubtleCrypto.digest).
 *
 * OpenRA 对照: OpenRA.Game/CryptoUtil.cs (SHA1Hash method)
 *
 * 核心范式转换:
 * - C# SHA1.HashData(Stream/byte[]) using System.Security.Cryptography
 *   → Web Crypto API `crypto.subtle.digest('SHA-1', data)`
 * - C# CryptoUtil.ToHex(source, lowerCase) → TypeScript
 *   `Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('')`
 * - C# case-insensitive string equality for SHA1 comparison
 *   → timing-safe character-by-character comparison with early length check
 */

// ---------------------------------------------------------------------------
// Sha1Verifier — Static SHA1 utilities
// ---------------------------------------------------------------------------

export class Sha1Verifier {
  /**
   * Compute the SHA1 hash of the given data.
   *
   * OpenRA 对照: CryptoUtil.SHA1Hash(byte[] data)
   *
   * Uses {@link https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest | SubtleCrypto.digest}
   * with the SHA-1 algorithm.
   *
   * @param data — The data to hash.
   * @returns Lowercase hex-encoded SHA1 digest (40 characters).
   */
  static async compute(data: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-1', data);
    return Sha1Verifier.bufferToHex(hashBuffer);
  }

  /**
   * Verify that the given data matches the expected SHA1 hash.
   *
   * The comparison is timing-safe: both strings are normalized to lowercase,
   * compared by length first, then compared character-by-character without
   * short-circuiting on the first mismatch.
   *
   * OpenRA 对照: CryptoUtil.SHA1Hash(Stream data) compared against expected
   *             SHA1 string (case-insensitive in practice, but this implementation
   *             adds timing safety).
   *
   * @param data — The data to verify.
   * @param expectedHexSha1 — The expected SHA1 hash (case-insensitive hex).
   * @returns `true` if the computed SHA1 matches the expected value.
   */
  static async verify(
    data: ArrayBuffer,
    expectedHexSha1: string,
  ): Promise<boolean> {
    const computed = await Sha1Verifier.compute(data);
    return Sha1Verifier.timingSafeEqual(computed, expectedHexSha1);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Convert an ArrayBuffer to a lowercase hex string.
   *
   * @param buffer — The buffer to convert.
   * @returns Lowercase hex string with no separators.
   */
  private static bufferToHex(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  /**
   * Timing-safe string equality comparison.
   *
   * Prevents timing side-channel attacks by:
   * 1. Comparing lengths first (necessary for the loop bound)
   * 2. Iterating over ALL characters even after finding a mismatch
   * 3. Using bitwise operations to avoid branch prediction leaks
   *
   * @param a — First hex string (already lowercase).
   * @param b — Second hex string (already lowercase).
   * @returns `true` if both strings are equal.
   */
  private static timingSafeEqual(a: string, b: string): boolean {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();

    if (aLower.length !== bLower.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < aLower.length; i++) {
      result |= aLower.charCodeAt(i) ^ bLower.charCodeAt(i);
    }
    return result === 0;
  }
}
