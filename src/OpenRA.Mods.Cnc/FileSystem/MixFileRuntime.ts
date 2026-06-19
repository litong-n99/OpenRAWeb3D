/**
 * MixFileRuntime.ts — Runtime C&C-format MIX file parser (Phase C: + RSA key path + OpenRA format)
 * OpenRA 对照: OpenRA.Mods.Cnc/FileSystem/MixFile.cs (MixLoader.MixFile)
 *
 * 核心范式转换:
 * - C# Stream + seek → DataView + ArrayBuffer offset-based access
 * - C# Blowfish/RSA decryption → Blowfish (FileFormats) for header decryption
 * - C# BlowfishKeyProvider.DecryptKey → JavaScript BigInt modular exponentiation
 *   (square-and-multiply, same algorithm as OpenRA's CalcKey)
 * - C# SegmentStream (lazy, shared buffer) → ArrayBuffer.slice() (eager independent copy)
 * - C# global mix database (XccGlobalDatabase) → optional mixDb Map<string, string>
 * - C# tryParsePackage returns MixFile → MixFileRuntime.parse() static factory
 * - C# Dictionary<uint, PackageEntry> index → Map<string, MixFileEntry> with pre-resolved names
 */

import type { IReadOnlyPackage, IReadOnlyFileSystem } from '../../OpenRA.Game/FileSystem/IPackage.js'
import { PackageEntry } from './PackageEntry.js'
import { Blowfish } from '../FileFormats/Blowfish.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Header size before entries: 2 (numFiles uint16) + 4 (totalSize uint32) = 6 bytes. */
const HEADER_SIZE = 6

/** Minimum valid C&C MIX has at least the header bytes. */
const MIN_VALID_SIZE = HEADER_SIZE

/** Minimum numFiles value to identify as C&C format (must be > 0; 0 indicates encrypted RA/TS). */
const MIN_CNC_FILES = 1

/** Maximum numFiles value for C&C format (uint16 range). */
const MAX_CNC_FILES = 65535

// ---------------------------------------------------------------------------
// Encrypted MIX format constants (Phase B)
// ---------------------------------------------------------------------------

/** Minimum buffer size for encrypted format detection (6 bytes: flags + dataSize). */
const ENCRYPTED_MIN_SIZE = 6

/**
 * OpenRA RA/TS/RA2 format marker: first uint16 == 0 indicates non-C&C format.
 * In OpenRA C#, the second uint16 at offset 2 is checked for bit 1 (encrypted).
 */
const OPENRA_FORMAT_MARKER = 0x0000

/** Bit 1 of the RA/TS/RA2 second uint16 indicates Blowfish-encrypted header. */
const OPENRA_ENCRYPTED_FLAG = 0x0002

/**
 * Universal key format: first uint16 == 1 (bit 0 set) means use a
 * hardcoded universal Blowfish key. No RSA keyblock in the file.
 */
const UNIVERSAL_KEY_FLAG = 0x0001

/**
 * RSA key format: first uint16 == 2 (bit 1 set) means the file contains
 * an RSA-encrypted Blowfish keyblock. Supported in Phase C.
 */
const RSA_KEY_FLAG = 0x0002

/**
 * Universal key encrypted MIX header offset.
 * Layout: flags(2) + dataSize(4) + encrypted_header...
 */
const UNIVERSAL_KEY_HEADER_OFFSET = 6

/**
 * OpenRA format: offset of the RSA-encrypted keyblock (80 bytes).
 * Encrypted header follows at offset 84 (4 + 80).
 *
 * OpenRA 对照: MixFile.DecryptHeader — offset 4, keyblock 80 bytes
 */
const OPENRA_KEYBLOCK_OFFSET = 4
const OPENRA_KEYBLOCK_SIZE = 80
const OPENRA_HEADER_OFFSET = OPENRA_KEYBLOCK_OFFSET + OPENRA_KEYBLOCK_SIZE // 84

// ---------------------------------------------------------------------------
// RSA constants (Phase C — Tiberian Sun / Red Alert 2 encrypted MIX)
// ---------------------------------------------------------------------------

/**
 * RSA public exponent for Blowfish key decryption.
 * OpenRA 对照: BlowfishKeyProvider.InitPublicKey — KeyTwo = {0x10001, 0, ..., 0}
 */
const RSA_EXPONENT = 65537n // 0x10001

/**
 * RSA public key modulus (base64-encoded big-endian integer).
 * OpenRA 对照: BlowfishKeyProvider.PublicKeyString
 *
 * Decoded: 42 bytes, ~330-bit modulus.
 */
const RSA_PUBLIC_KEY_B64 = 'AihRvNoIbTn85FZRYNZRcT+i6KpU+maCsEqr3Q5q+LDB5tH7Tz2qQ38V'

/** RSA key chunk output size in bytes. Computed from modulus bit length.
 * OpenRA 对照: a = (int)((pubkey.Len - 1) / 8)  — output bytes per chunk */
let _rsaChunkOutSize = -1

/** RSA key chunk input size in bytes (output + 1).
 * OpenRA 对照: a + 1  — input bytes per chunk */
let _rsaChunkInSize = -1

/** Decoded RSA modulus as BigInt, lazily computed. */
let _rsaModulus: bigint | null = null

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Internal per-file entry with absolute offset for efficient data slicing.
 *
 * OpenRA 对照: PackageEntry with dataStart pre-applied (cf. MixLoader.MixFile.Index getter)
 */
interface MixFileEntry {
  hash: number
  /** Absolute byte offset in the ArrayBuffer (dataStart + pkgEntry.offset). */
  offset: number
  size: number
}

// ---------------------------------------------------------------------------
// MixFileRuntime
// ---------------------------------------------------------------------------

/**
 * Runtime C&C-format MIX file package parser.
 *
 * OpenRA 对照: OpenRA.Mods.Cnc.FileSystem.MixLoader.MixFile
 *
 * Parses unencrypted C&C-format MIX archives at runtime. Designed for the
 * Content Installer pipeline, where downloaded ZIPs from OpenRA mirrors
 * contain `.mix` files that must be extracted at runtime.
 *
 * ## C&C MIX Binary Format (little-endian)
 *
 * ```
 * Offset  Size    Field
 * 0       2       numFiles (uint16) — must be > 0 and ≤ 65535 for C&C
 * 2       4       totalSize (uint32) — total size of all data blocks
 * 6       N×12    PackageEntry[] entries (hash, offset, size)
 * 6+N×12  ...     Raw data blocks at specified offsets
 * ```
 *
 * Data block offsets in PackageEntry records are relative to the end of the
 * entry table (i.e., `dataStart = 6 + numFiles * 12`). This class applies
 * dataStart to convert all offsets to absolute positions during parse.
 */
export class MixFileRuntime implements IReadOnlyPackage {
  // -----------------------------------------------------------------------
  // Public properties
  // -----------------------------------------------------------------------

  /** Package name (e.g. "allies.mix").
   * OpenRA 对照: MixLoader.MixFile.Name */
  readonly name: string

  // -----------------------------------------------------------------------
  // Private state
  // -----------------------------------------------------------------------

  /** Sorted list of resolved filenames in this package. Frozen for immutability.
   * OpenRA 对照: MixLoader.MixFile.Contents (IEnumerable<string>) */
  private readonly _contents: readonly string[]

  /** Filename → entry map for data access.
   * OpenRA 对照: MixLoader.MixFile.index (Dictionary<string, PackageEntry>) */
  private readonly _entries: Map<string, MixFileEntry>

  /** Reference to the raw MIX file data array.
   * OpenRA 对照: MixLoader.MixFile.s (Stream)
   * Set to null on dispose() to release memory. */
  private _data: ArrayBuffer | null

  // -----------------------------------------------------------------------
  // Constructor (private — use parse() factory)
  // -----------------------------------------------------------------------

  /**
   * Private constructor. Use {@link MixFileRuntime.parse} to create instances.
   *
   * OpenRA 对照: MixLoader.MixFile(Stream, string, string[])
   *
   * @param name — package filename
   * @param data — raw MIX data (retained for lazy access)
   * @param entries — pre-resolved filename → absolute-offset entry map
   */
  private constructor(
    name: string,
    data: ArrayBuffer,
    entries: Map<string, MixFileEntry>,
  ) {
    this.name = name
    this._data = data
    this._entries = entries
    this._contents = Object.freeze(
      Array.from(entries.keys()).sort(),
    )
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — contents
  // -----------------------------------------------------------------------

  /**
   * The sorted filenames contained in this package.
   *
   * OpenRA 对照: MixLoader.MixFile.Contents (IEnumerable<string>)
   *
   * @returns a frozen, sorted array of resolved filenames
   */
  get contents(): readonly string[] {
    return this._contents
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — contains
  // -----------------------------------------------------------------------

  /**
   * Check if a filename exists in this MIX package.
   *
   * OpenRA 对照: MixLoader.MixFile.Contains(string)
   *
   * @param filename — the filename to look up
   * @returns true if the file is present
   */
  contains(filename: string): boolean {
    return this._entries.has(filename)
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — open
  // -----------------------------------------------------------------------

  /**
   * Open a file from this MIX and return its content as an independent copy.
   *
   * OpenRA 对照: MixLoader.MixFile.GetStream(string)
   *
   * Per the `IReadOnlyPackage` contract, the returned `ArrayBuffer` is always
   * an independent copy (via `slice()`), never a shared view. This ensures
   * cached entries remain independent of subsequent calls.
   *
   * Edge cases handled:
   * - File past end of buffer → truncated to available bytes
   * - File offset beyond buffer length → returns null
   * - After dispose() → returns null (buffer released)
   *
   * @param filename — the filename to open
   * @param _files — file system context (unused; MIX files do not nest)
   * @returns the file data as an independent ArrayBuffer, or null if not found
   */
  async open(filename: string, _files?: IReadOnlyFileSystem): Promise<ArrayBuffer | null> {
    if (!this._data) return null

    const entry = this._entries.get(filename)
    if (!entry) return null

    const start = entry.offset
    let end = start + entry.size

    // Clamp to available buffer bounds for truncated/corrupt MIX files
    if (start > this._data.byteLength) {
      return null
    }
    // Allow zero-length files at the exact end of buffer (genuine 0-byte entry)
    if (start === this._data.byteLength && entry.size === 0) {
      return new ArrayBuffer(0)
    }
    // Offset at buffer end with non-zero size means truncated data
    if (start >= this._data.byteLength) {
      return null
    }
    if (end > this._data.byteLength) {
      end = this._data.byteLength
    }

    // slice() creates an independent copy per IReadOnlyPackage contract
    return this._data.slice(start, end)
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — openPackage
  // -----------------------------------------------------------------------

  /**
   * MIX files do not contain sub-packages. Always returns null.
   *
   * OpenRA 对照: MixLoader.MixFile.OpenPackage(string, FileSystem)
   *
   * Unlike ZIP archives, MIX files are flat containers with no nesting.
   *
   * @param _filename — unused
   * @param _files — unused
   * @returns always null
   */
  openPackage(_filename: string, _files?: IReadOnlyFileSystem): IReadOnlyPackage | null {
    return null
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — dispose
  // -----------------------------------------------------------------------

  /**
   * Release the internal ArrayBuffer reference and clear the entries map.
   *
   * OpenRA 对照: MixLoader.MixFile.Dispose()
   *
   * After disposal, `open()` returns null for all filenames and `contains()`
   * returns false. The object should not be used after disposal.
   */
  dispose(): void {
    this._data = null
    this._entries.clear()
  }

  // -----------------------------------------------------------------------
  // Static factory — parse
  // -----------------------------------------------------------------------

  /**
   * Parse a C&C-format MIX file into a `MixFileRuntime` instance.
   *
   * OpenRA 对照: MixLoader.MixFile constructor (parsing path for isCncMix == true)
   *
   * Parses the binary header to extract file metadata, resolves filenames
   * via the optional `mixDb`, and stores absolute data offsets for subsequent
   * `open()` calls.
   *
   * ## Filename resolution
   *
   * Each entry stores a Westwood filename hash (uint32). To resolve it:
   *
   * 1. Convert the hash to a hex key: `"0x" + hash.toString(16).toUpperCase().padStart(8, '0')`
   * 2. Look up the hex key in `mixDb`:
   *    - If found → use the resolved filename
   *    - If not found → use a placeholder: `"unresolved_0xHHHHHHHH.bin"`
   * 3. If `mixDb` is not provided at all, all entries get placeholder names.
   * 4. Duplicate filenames (after resolution) overwrite: the last entry wins.
   *
   * @param name — package name (e.g. "allies.mix")
   * @param data — raw MIX file data (ownership is transferred; the caller should not
   *               modify the buffer after passing it in)
   * @param mixDb — optional hash-to-filename database.
   *                Keys are hex-formatted like `"0x1234ABCD"` (uppercase, 8-digit zero-padded).
   * @returns a parsed MixFileRuntime instance
   * @throws Error if the data is not valid C&C format
   */
  static parse(name: string, data: ArrayBuffer, mixDb?: Map<string, string>): MixFileRuntime {
    if (!MixFileRuntime.isCncFormat(data)) {
      throw new Error(
        `MixFileRuntime.parse: "${name}" is not a valid C&C-format MIX file. ` +
        `The first uint16 is 0 (indicating encrypted RA/TS/RA2 format) or the file is too small. ` +
        `Use parseEncrypted() for encrypted MIX files (requires Blowfish key or RSA decryption).`,
      )
    }

    const dv = new DataView(data)
    const numFiles = dv.getUint16(0, true)
    // totalSize is read but not separately used — file lengths come from entries
    // dv.getUint32(2, true) — totalSize of data blocks

    // Parse all PackageEntry records from the header
    const pkgEntries: PackageEntry[] = []
    let entryOffset = HEADER_SIZE // = 6
    for (let i = 0; i < numFiles; i++) {
      const { entry, nextOffset } = PackageEntry.fromDataView(dv, entryOffset)
      pkgEntries.push(entry)
      entryOffset = nextOffset
    }

    // dataStart is the byte offset at which raw data blocks begin
    const dataStart = entryOffset // = HEADER_SIZE + numFiles * ENTRY_SIZE

    // Resolve filenames and build internal entry map (shared helper)
    const entries = MixFileRuntime._buildEntryMap(pkgEntries, dataStart, mixDb)

    return new MixFileRuntime(name, data, entries)
  }

  // -----------------------------------------------------------------------
  // Static — isCncFormat
  // -----------------------------------------------------------------------

  /**
   * Check if the data appears to be a C&C-format (unencrypted) MIX file.
   *
   * OpenRA 对照: MixLoader.MixFile constructor (`var isCncMix = s.ReadUInt16() != 0`)
   *
   * **C&C format**: the first uint16 is the number of files (always > 0).
   * **RA/TS/RA2 format**: the first uint16 is 0 (a flags field where bit 1
   *   indicates Blowfish encryption). In this case, `numFiles` starts at offset 2.
   *
   * This method only returns `true` for C&C format. Encrypted formats are
   * rejected because Phase A does not include Blowfish/RSA support.
   *
   * @param data — raw file data to inspect
   * @returns true if the data looks like an unencrypted C&C MIX file
   */
  static isCncFormat(data: ArrayBuffer): boolean {
    if (data.byteLength < MIN_VALID_SIZE) return false

    const dv = new DataView(data)
    const firstUint16 = dv.getUint16(0, true)

    // C&C: first uint16 > 0 (it is numFiles). RA/TS/RA2: first uint16 == 0 (flags).
    return firstUint16 >= MIN_CNC_FILES && firstUint16 <= MAX_CNC_FILES
  }

  // -----------------------------------------------------------------------
  // Static — encrypted format support (Phase B)
  // -----------------------------------------------------------------------

  /**
   * Default Blowfish key used for encrypted MIX decryption.
   *
   * Set via {@link MixFileRuntime.setDefaultEncryptedKey}.
   * When null, encrypted MIX parsing is disabled.
   *
   * TODO-10.B.1: Replace with the actual universal Blowfish key for RA/TS MIX files.
   * The universal key is a 56-byte constant used by XCC utilities. It can be
   * extracted from OpenRA's BlowfishKeyProvider by RSA-decrypting the keyblock
   * from a known RA MIX file, then hardcoded here. Until the key is obtained,
   * encrypted MIX parsing requires an explicit key parameter to parseEncrypted().
   */
  private static _defaultEncryptedKey: Uint8Array | null = null

  /**
   * Set the default Blowfish key for encrypted MIX decryption.
   *
   * This key is shared across all encrypted MIX parses that do not provide
   * an explicit key. Call this during app initialization after deriving or
   * loading the key.
   *
   * @param key — 56-byte Blowfish key (universal key for RA/TS MIX files),
   *              or null to disable automatic encrypted MIX parsing
   */
  static setDefaultEncryptedKey(key: Uint8Array | null): void {
    MixFileRuntime._defaultEncryptedKey = key
  }

  /**
   * Check if the data appears to be an encrypted RA/TS/RA2 MIX file.
   *
   * OpenRA 对照: `var isEncrypted = (s.ReadUInt16() & 0x2) != 0`
   *
   * Detects two encrypted format variants:
   *
   * **OpenRA format** (matching C# MixFile.cs):
   * - First uint16 == 0 (RA/TS/RA2 format marker)
   * - Second uint16 has bit 1 set (encrypted flag)
   *
   * **Universal key format** (simpler, no RSA keyblock):
   * - First uint16 == 1 (bit 0 set = universal key)
   *
   * NOTE: A first uint16 of 2 (bit 1 set = RSA key) is also an encrypted
   * format, but it is not supported in Phase B. It is detected here for
   * clear error messaging but parseEncrypted() will refuse it.
   *
   * @param data — raw file data to inspect
   * @returns true if the data appears to be an encrypted MIX file
   */
  static isEncryptedFormat(data: ArrayBuffer): boolean {
    if (data.byteLength < ENCRYPTED_MIN_SIZE) return false

    const dv = new DataView(data)
    const firstUint16 = dv.getUint16(0, true)

    // OpenRA format: first uint16 == 0, check second uint16 for encrypted flag
    if (firstUint16 === OPENRA_FORMAT_MARKER) {
      if (data.byteLength >= 4) {
        const secondUint16 = dv.getUint16(2, true)
        return (secondUint16 & OPENRA_ENCRYPTED_FLAG) !== 0
      }
      return false
    }

    // Universal key format: first uint16 == 1 (bit 0 set)
    if (firstUint16 === UNIVERSAL_KEY_FLAG) {
      return true
    }

    // RSA key format: first uint16 == 2 (bit 1 set) — detected but not supported
    if (firstUint16 === RSA_KEY_FLAG) {
      return true
    }

    return false
  }

  /**
   * Parse an encrypted RA/TS/RA2 MIX file into a `MixFileRuntime` instance.
   *
   * OpenRA 对照: MixLoader.MixFile constructor (encrypted path with Blowfish)
   *
   * Supports two encrypted format variants:
   *
   * **Universal key format** (flags == 1 at offset 0):
   * ```
   * Offset  Size  Description
   * 0       2     flags (uint16 LE) = 0x0001 (universal key)
   * 2       4     dataSize (uint32 LE) — total size of all data blocks
   * 6       N*8   Blowfish-encrypted header (padded to 8-byte blocks)
   * 6+N*8   ...   Raw data blocks
   * ```
   * The header, after Blowfish decryption, contains:
   * - uint16 numFiles
   * - uint32 dataSize (duplicate of offset 2)
   * - PackageEntry[] entries (12 bytes each)
   *
   * **OpenRA format** (flags == 0 at offset 0, bit 1 at offset 2):
   * ```
   * Offset  Size  Description
   * 0       2     flags (uint16 LE) = 0x0000
   * 2       2     subFlags (uint16 LE), bit 1 = encrypted
   * 4       80    RSA-encrypted Blowfish keyblock
   * 84      N*8   Blowfish-encrypted header
   * 84+N*8  ...   Raw data blocks
   * ```
   * NOTE: OpenRA format requires RSA key decryption, not supported in Phase B.
   *
   * @param name — package name (e.g. "scores.mix")
   * @param data — raw MIX file data
   * @param key — Blowfish key (56 bytes). If not provided, uses the default
   *              key set via {@link setDefaultEncryptedKey}. For universal key
   *              format, this must be the universal RA/TS key.
   * @param mixDb — optional hash-to-filename database
   * @returns a parsed MixFileRuntime instance
   * @throws Error if the data is not a supported encrypted format or
   *               if no key is available
   */
  static parseEncrypted(
    name: string,
    data: ArrayBuffer,
    key?: Uint8Array,
    mixDb?: Map<string, string>,
  ): MixFileRuntime {
    if (!MixFileRuntime.isEncryptedFormat(data)) {
      throw new Error(
        `MixFileRuntime.parseEncrypted: "${name}" is not a recognized encrypted MIX format.`,
      )
    }

    const dv = new DataView(data)
    const firstUint16 = dv.getUint16(0, true)

    // Determine format and decrypt accordingly
    if (firstUint16 === RSA_KEY_FLAG) {
      // RSA key format (flags=0x0002): encrypted header with RSA-decrypted key
      return MixFileRuntime._parseEncryptedRsaKey(name, data, mixDb)
    }

    if (firstUint16 === OPENRA_FORMAT_MARKER) {
      // OpenRA format (flags=0x0000): RSA-encrypted keyblock at offset 4
      return MixFileRuntime._parseEncryptedOpenRA(name, data, mixDb)
    }

    const effectiveKey = key ?? MixFileRuntime._defaultEncryptedKey
    if (!effectiveKey || effectiveKey.length === 0) {
      throw new Error(
        `MixFileRuntime.parseEncrypted: no Blowfish key available for "${name}". ` +
        `Call MixFileRuntime.setDefaultEncryptedKey() or pass a key explicitly. ` +
        `TODO-10.B.1: The universal RA/TS Blowfish key must be extracted from OpenRA.`,
      )
    }

    if (firstUint16 === UNIVERSAL_KEY_FLAG) {
      // Universal key format: encrypted header at offset 6
      return MixFileRuntime._parseEncryptedUniversalKey(name, data, effectiveKey, mixDb)
    }

    throw new Error(
      `MixFileRuntime.parseEncrypted: unknown encrypted format for "${name}" ` +
      `(flags=0x${firstUint16.toString(16)}).`,
    )
  }

  /**
   * Parse a universal key format encrypted MIX file.
   *
   * Format: flags(2) + dataSize(4) + Blowfish-encrypted header(N*8) + data blocks.
   *
   * @param name — package name
   * @param data — raw MIX data
   * @param key — Blowfish key
   * @param mixDb — optional hash-to-filename database
   * @returns parsed MixFileRuntime
   */
  private static _parseEncryptedUniversalKey(
    name: string,
    data: ArrayBuffer,
    key: Uint8Array,
    mixDb?: Map<string, string>,
  ): MixFileRuntime {
    const fish = new Blowfish(key)

    // Decrypt the header starting at offset 6
    const { entries: pkgEntries, headerByteLength } =
      MixFileRuntime._decryptHeaderUniversalKey(data, fish)

    // dataStart is after the encrypted header
    const dataStart = UNIVERSAL_KEY_HEADER_OFFSET + headerByteLength

    // Resolve filenames and build internal entry map
    const entries = MixFileRuntime._buildEntryMap(pkgEntries, dataStart, mixDb)

    return new MixFileRuntime(name, data, entries)
  }

  /**
   * Decrypt and parse the header in universal key format.
   *
   * OpenRA 对照: MixFile.DecryptHeader() (simplified: no RSA step)
   *
   * 1. Read and decrypt the first 8-byte block at UNIVERSAL_KEY_HEADER_OFFSET
   * 2. Get numFiles from the decrypted data
   * 3. Calculate total header size and round up to 8-byte blocks
   * 4. Read and decrypt all header blocks
   * 5. Parse PackageEntry records from the decrypted header
   *
   * @param data — raw MIX data
   * @param fish — initialized Blowfish cipher
   * @returns parsed entries and the encrypted header's total byte length
   */
  private static _decryptHeaderUniversalKey(
    data: ArrayBuffer,
    fish: Blowfish,
  ): { entries: PackageEntry[]; headerByteLength: number } {
    // Decrypt first block (8 bytes) to get numFiles
    // NOTE: Must copy to aligned buffer — ArrayBuffer offsets may not be
    // 4-byte aligned, which Uint32Array requires.
    const firstBlockSrc = new Uint8Array(data, UNIVERSAL_KEY_HEADER_OFFSET, 8)
    const firstBlockBuf = new ArrayBuffer(8)
    new Uint8Array(firstBlockBuf).set(firstBlockSrc)
    const firstBlockU32 = new Uint32Array(firstBlockBuf, 0, 2)
    const decryptedFirst = fish.decrypt(firstBlockU32)

    // numFiles is the first uint16 (little-endian) in the decrypted data
    // The decrypted result is a Uint32Array — read as byte array
    const decryptedFirstBytes = new Uint8Array(decryptedFirst.buffer, decryptedFirst.byteOffset, 8)
    const numFiles = new DataView(decryptedFirstBytes.buffer, decryptedFirstBytes.byteOffset, 8).getUint16(0, true)

    // Total header size: 2 (numFiles) + 4 (dataSize) + numFiles * 12 (entries)
    const headerSize = 6 + numFiles * PackageEntry.SIZE
    // Round up to 8-byte blocks (Blowfish block size)
    const blockCount = Math.ceil(headerSize / 8)
    const headerByteLength = blockCount * 8

    // Read all header blocks (copy to aligned buffer for Uint32Array)
    const encryptedHeaderSrc = new Uint8Array(data, UNIVERSAL_KEY_HEADER_OFFSET, headerByteLength)
    const headerBuf = new ArrayBuffer(headerByteLength)
    new Uint8Array(headerBuf).set(encryptedHeaderSrc)
    const headerU32 = new Uint32Array(headerBuf, 0, blockCount * 2)
    const decryptedHeader = fish.decrypt(headerU32)

    // Parse PackageEntry records from decrypted header
    const decryptedBytes = new Uint8Array(
      decryptedHeader.buffer,
      decryptedHeader.byteOffset,
      headerByteLength,
    )
    const decryptedDv = new DataView(
      decryptedBytes.buffer,
      decryptedBytes.byteOffset,
      decryptedBytes.byteLength,
    )

    const entries: PackageEntry[] = []
    // Skip numFiles (uint16, 2 bytes) and dataSize (uint32, 4 bytes) = 6 bytes offset
    let entryOffset = 6
    for (let i = 0; i < numFiles; i++) {
      const { entry, nextOffset } = PackageEntry.fromDataView(decryptedDv, entryOffset)
      entries.push(entry)
      entryOffset = nextOffset
    }

    return { entries, headerByteLength }
  }

  // -----------------------------------------------------------------------
  // RSA key decryption (Phase C — Tiberian Sun / RA2 encrypted MIX)
  // -----------------------------------------------------------------------

  /**
   * Decrypt the Blowfish key from the RSA-encrypted keyblock in an
   * OpenRA format MIX file.
   *
   * OpenRA 对照: BlowfishKeyProvider.DecryptKey(byte[])
   *
   * Uses JavaScript BigInt for modular exponentiation (square-and-multiply).
   * The 80-byte encrypted keyblock is split into chunks and each chunk
   * is RSA-decrypted independently, matching OpenRA's ProcessPredata.
   *
   * Algorithm (mirrors OpenRA C#):
   * 1. Decode base64 RSA modulus → BigInt
   * 2. Compute chunk sizes: outSize = floor((modulusBitLen - 1) / 8), inSize = outSize + 1
   * 3. For each chunk of inSize bytes from the keyblock:
   *    a. Convert to BigInt (big-endian unsigned)
   *    b. Compute plaintext = ciphertext^exponent mod modulus
   *    c. Convert plaintext to outSize bytes
   * 4. Concatenate all chunk outputs
   * 5. Return the last 56 bytes as the Blowfish key
   *
   * @param encryptedKeyblock — 80-byte RSA-encrypted keyblock from MIX header
   * @returns 56-byte Blowfish key
   */
  private static _rsaDecryptKey(encryptedKeyblock: Uint8Array): Uint8Array {
    const modulus = MixFileRuntime._getRsaModulus()
    const { outSize, inSize } = MixFileRuntime._getRsaChunkSizes(modulus)

    // pre_len: total input bytes to process (matches OpenRA's pre_len calculation)
    const preLen = (Math.floor(55 / outSize) + 1) * inSize

    // Decrypt chunks
    const dest = new Uint8Array(preLen)
    let srcOffset = 0
    let destOffset = 0

    for (let remaining = preLen; inSize <= remaining; remaining -= inSize) {
      // Extract inSize bytes from encrypted keyblock (pad with zeros if needed)
      const chunkBytes = new Uint8Array(inSize)
      for (let i = 0; i < inSize; i++) {
        chunkBytes[i] = srcOffset + i < encryptedKeyblock.length
          ? encryptedKeyblock[srcOffset + i]
          : 0
      }

      // Convert encrypted chunk to BigInt (little-endian unsigned)
      // OpenRA 对照: Buffer.BlockCopy copies bytes directly into LE uint32 array;
      // first byte of src becomes LSB of the BigInt value
      const chunkBigInt = MixFileRuntime._bytesToBigIntLE(chunkBytes)

      // RSA decrypt: plaintext = ciphertext^exponent mod modulus
      const decryptedBigInt = MixFileRuntime._modPow(chunkBigInt, RSA_EXPONENT, modulus)

      // Extract LEAST significant outSize bytes (matches OpenRA's
      // Buffer.BlockCopy(n3, 0, dest, destOffset, a) which copies
      // bytes from the start of the little-endian uint array)
      // OpenRA 对照: first `a` bytes of n3 (least significant bytes)
      let remainingVal = decryptedBigInt
      for (let i = 0; i < outSize; i++) {
        dest[destOffset + i] = Number(remainingVal & 0xFFn)
        remainingVal >>= 8n
      }

      srcOffset += inSize
      destOffset += outSize
    }

    // Return first 56 bytes (the Blowfish key)
    // OpenRA 对照: ProcessPredata(src).Take(56).ToArray()
    return dest.slice(0, 56)
  }

  /**
   * Decode the base64 RSA modulus and return it as a BigInt.
   * Result is lazily cached for subsequent calls.
   *
   * OpenRA 对照: KeyToBigNum(pubkey.KeyOne, Convert.FromBase64String(PublicKeyString), 64)
   *
   * The base64 string decodes to a DER-encoded ASN.1 INTEGER:
   * - Byte 0: 0x02 (DER INTEGER tag)
   * - Byte 1: length (0x28 = 40 bytes of modulus)
   * - Bytes 2-41: 40-byte RSA modulus (big-endian unsigned)
   *
   * OpenRA's KeyToBigNum strips the DER header and passes the raw modulus
   * bytes to MoveKeyToBig, which reverses them into a LE uint32 array.
   * The net effect (MoveKeyToBig reversal + LE uint32) is big-endian
   * interpretation, so we use _bytesToBigIntBE().
   */
  private static _getRsaModulus(): bigint {
    if (_rsaModulus !== null) return _rsaModulus

    // Decode base64: atob → raw DER-encoded bytes
    const binaryStr = atob(RSA_PUBLIC_KEY_B64)
    const derBytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) {
      derBytes[i] = binaryStr.charCodeAt(i)
    }

    // Strip DER header: byte 0 = 0x02 (INTEGER tag), byte 1 = length
    const modulusLen = derBytes[1]
    const modulusBytes = derBytes.slice(2, 2 + modulusLen)

    _rsaModulus = MixFileRuntime._bytesToBigIntBE(modulusBytes)
    return _rsaModulus
  }

  /**
   * Compute RSA chunk sizes from the modulus.
   * OpenRA 对照: a = (int)((pubkey.Len - 1) / 8)
   */
  private static _getRsaChunkSizes(modulus: bigint): { outSize: number; inSize: number } {
    if (_rsaChunkOutSize < 0) {
      const bitLen = MixFileRuntime._bitLength(modulus)
      _rsaChunkOutSize = Math.floor((bitLen - 1) / 8)
      _rsaChunkInSize = _rsaChunkOutSize + 1
    }
    return { outSize: _rsaChunkOutSize, inSize: _rsaChunkInSize }
  }

  // -----------------------------------------------------------------------
  // BigInt utility functions
  // -----------------------------------------------------------------------

  /**
   * Convert a Uint8Array (big-endian unsigned, first byte = MSB) to BigInt.
   *
   * Used for the RSA modulus (loaded via MoveKeyToBig which reverses bytes
   * into a LE uint32 array — net effect is big-endian interpretation).
   */
  private static _bytesToBigIntBE(bytes: Uint8Array): bigint {
    let result = 0n
    for (let i = 0; i < bytes.length; i++) {
      result = (result << 8n) | BigInt(bytes[i])
    }
    return result
  }

  /**
   * Convert a Uint8Array (little-endian unsigned, first byte = LSB) to BigInt.
   *
   * Used for encrypted keyblock chunks (loaded via Buffer.BlockCopy which
   * copies bytes directly into a LE uint32 array — first byte = LSB).
   */
  private static _bytesToBigIntLE(bytes: Uint8Array): bigint {
    let result = 0n
    for (let i = bytes.length - 1; i >= 0; i--) {
      result = (result << 8n) | BigInt(bytes[i])
    }
    return result
  }

  /**
   * Compute the bit length of a positive BigInt.
   */
  private static _bitLength(n: bigint): number {
    if (n === 0n) return 0
    return n.toString(2).length
  }

  /**
   * Modular exponentiation (square-and-multiply algorithm).
   *
   * OpenRA 对照: BlowfishKeyProvider.CalcKey — same algorithm, implemented
   * with uint64 arrays in C#, using JavaScript BigInt here.
   *
   * Computes: base^exp mod modulus
   *
   * @param base — the base value
   * @param exp — the exponent
   * @param modulus — the modulus
   * @returns base^exp mod modulus
   */
  private static _modPow(base: bigint, exp: bigint, modulus: bigint): bigint {
    if (modulus === 1n) return 0n

    let result = 1n
    let b = base % modulus
    let e = exp

    while (e > 0n) {
      if (e & 1n) {
        result = (result * b) % modulus
      }
      e >>= 1n
      b = (b * b) % modulus
    }

    return result
  }

  // -----------------------------------------------------------------------
  // OpenRA format encrypted MIX parsing (Phase C)
  // -----------------------------------------------------------------------

  /**
   * Parse an OpenRA format encrypted MIX file (flags=0, encrypted bit set).
   *
   * OpenRA 对照: MixFile constructor — encrypted path for RA/TS/RA2 format
   *
   * Format:
   * ```
   * Offset  Size  Description
   * 0       2     flags (uint16 LE) = 0x0000
   * 2       2     subFlags (uint16 LE), bit 1 = encrypted
   * 4       80    RSA-encrypted Blowfish keyblock
   * 84      N*8   Blowfish-encrypted header (padded to 8-byte blocks)
   * 84+N*8  ...   Raw data blocks
   * ```
   *
   * @param name — package name
   * @param data — raw MIX data
   * @param mixDb — optional hash-to-filename database
   * @returns parsed MixFileRuntime
   */
  private static _parseEncryptedOpenRA(
    name: string,
    data: ArrayBuffer,
    mixDb?: Map<string, string>,
  ): MixFileRuntime {
    // 1. Extract RSA-encrypted Blowfish keyblock at offset 4
    const keyblockSrc = new Uint8Array(data, OPENRA_KEYBLOCK_OFFSET, OPENRA_KEYBLOCK_SIZE)

    // DIAGNOSTIC: log keyblock prefix and flags before RSA decryption
    {
      const keyblockHex = Array.from(keyblockSrc.slice(0, 16))
        .map(b => b.toString(16).padStart(2, '0')).join(' ')
      const flagsDv = new DataView(data)
      console.log(
        `MixFileRuntime: "${name}" keyblock first 16 bytes: ${keyblockHex}... ` +
        `(flags=0x${flagsDv.getUint16(0, true).toString(16)}, subFlags=0x${flagsDv.getUint16(2, true).toString(16)})`,
      )
    }

    // 2. RSA-decrypt the Blowfish key
    const blowfishKey = MixFileRuntime._rsaDecryptKey(keyblockSrc)

    // DIAGNOSTIC: log derived Blowfish key prefix
    {
      const keyHex = Array.from(blowfishKey.slice(0, 8))
        .map(b => b.toString(16).padStart(2, '0')).join(' ')
      console.log(
        `MixFileRuntime: "${name}" derived Blowfish key first 8 bytes: ${keyHex}...`,
      )
    }

    // 3. Create Blowfish cipher
    const fish = new Blowfish(blowfishKey)

    // 4. Decrypt header at offset 84
    const { entries: pkgEntries, headerByteLength } =
      MixFileRuntime._decryptHeaderOpenRA(data, fish)

    // 5. dataStart is after the encrypted header
    const dataStart = OPENRA_HEADER_OFFSET + headerByteLength

    // 6. Resolve filenames and build entry map
    const entries = MixFileRuntime._buildEntryMap(pkgEntries, dataStart, mixDb)

    return new MixFileRuntime(name, data, entries)
  }

  /**
   * Decrypt and parse the header in OpenRA format (encrypted header at offset 84).
   *
   * OpenRA 对照: MixFile.DecryptHeader(Stream, long offset, out long headerEnd)
   *
   * @param data — raw MIX data
   * @param fish — initialized Blowfish cipher
   * @returns parsed entries and the encrypted header's total byte length
   */
  private static _decryptHeaderOpenRA(
    data: ArrayBuffer,
    fish: Blowfish,
  ): { entries: PackageEntry[]; headerByteLength: number } {
    // Decrypt first block (8 bytes) at OPENRA_HEADER_OFFSET to get numFiles
    const firstBlockSrc = new Uint8Array(data, OPENRA_HEADER_OFFSET, 8)
    const firstBlockBuf = new ArrayBuffer(8)
    new Uint8Array(firstBlockBuf).set(firstBlockSrc)
    const firstBlockU32 = new Uint32Array(firstBlockBuf, 0, 2)
    const decryptedFirst = fish.decrypt(firstBlockU32)

    const decryptedFirstBytes = new Uint8Array(
      decryptedFirst.buffer, decryptedFirst.byteOffset, 8,
    )
    const numFiles = new DataView(
      decryptedFirstBytes.buffer, decryptedFirstBytes.byteOffset, 8,
    ).getUint16(0, true)

    // Validate: numFiles must be in a reasonable range.
    // A garbage value here means the RSA/Blowfish key was wrong and the
    // header decrypted to junk. (Common causes: RSA DER/byte-order bugs,
    // wrong Blowfish key, or the file is not actually encrypted MIX.)
    if (numFiles === 0 || numFiles > 65535) {
      const headerHex = Array.from(decryptedFirstBytes.slice(0, 8))
        .map(b => b.toString(16).padStart(2, '0')).join(' ')
      throw new Error(
        `Decrypted header numFiles=${numFiles} is out of range [1, 65535]. ` +
        `Decrypted header first 8 bytes: ${headerHex}. ` +
        `The Blowfish key derived from RSA decryption is likely incorrect.`,
      )
    }

    // Total header size and block count (integer division, matches OpenRA C#)
    // OpenRA 对照: var blockCount = (13 + numFiles * PackageEntry.Size) / 8;
    // 13 = 6 (header prefix) + 7 (rounding up before integer division)
    const blockCount = Math.floor((13 + numFiles * PackageEntry.SIZE) / 8)
    const headerByteLength = blockCount * 8

    // Read all header blocks
    const encryptedHeaderSrc = new Uint8Array(data, OPENRA_HEADER_OFFSET, headerByteLength)
    const headerBuf = new ArrayBuffer(headerByteLength)
    new Uint8Array(headerBuf).set(encryptedHeaderSrc)
    const headerU32 = new Uint32Array(headerBuf, 0, blockCount * 2)
    const decryptedHeader = fish.decrypt(headerU32)

    // Parse PackageEntry records
    const decryptedBytes = new Uint8Array(
      decryptedHeader.buffer, decryptedHeader.byteOffset, headerByteLength,
    )
    const decryptedDv = new DataView(
      decryptedBytes.buffer, decryptedBytes.byteOffset, decryptedBytes.byteLength,
    )

    const entries: PackageEntry[] = []
    let entryOffset = 6 // skip numFiles (uint16) + dataSize (uint32)
    for (let i = 0; i < numFiles; i++) {
      const { entry, nextOffset } = PackageEntry.fromDataView(decryptedDv, entryOffset)
      entries.push(entry)
      entryOffset = nextOffset
    }

    return { entries, headerByteLength }
  }

  /**
   * Parse an RSA key format encrypted MIX file (flags=2 at offset 0).
   *
   * Same layout as universal key format but uses RSA-decrypted key
   * instead of the hardcoded universal key.
   *
   * OpenRA 对照: MixFile constructor — encrypted path (first uint16 == 0)
   *
   * @param name — package name
   * @param data — raw MIX data
   * @param mixDb — optional hash-to-filename database
   * @returns parsed MixFileRuntime
   */
  private static _parseEncryptedRsaKey(
    name: string,
    data: ArrayBuffer,
    mixDb?: Map<string, string>,
  ): MixFileRuntime {
    // RSA key format: the entire header structure follows the flags
    // The 80-byte keyblock starts at offset 4 (after flags+dataSize = 2+2=4 bytes)
    // Then the encrypted header follows at offset 4+80=84
    const dv = new DataView(data)
    dv.getUint16(0, true) // flags = 0x0002 (already verified)
    dv.getUint32(2, true) // dataSize (not used for offset calculation)

    // Extract and decrypt the Blowfish key
    const keyblockSrc = new Uint8Array(data, 4, OPENRA_KEYBLOCK_SIZE)
    const blowfishKey = MixFileRuntime._rsaDecryptKey(keyblockSrc)
    const fish = new Blowfish(blowfishKey)

    // Decrypt header — same layout as OpenRA format (header at offset 84)
    const { entries: pkgEntries, headerByteLength } =
      MixFileRuntime._decryptHeaderOpenRA(data, fish)

    const dataStart = OPENRA_HEADER_OFFSET + headerByteLength
    const entries = MixFileRuntime._buildEntryMap(pkgEntries, dataStart, mixDb)

    return new MixFileRuntime(name, data, entries)
  }

  /**
   * Build the internal filename-to-entry map from a list of PackageEntry records.
   *
   * Shared by both C&C and encrypted parse paths.
   *
   * @param pkgEntries — parsed PackageEntry records
   * @param dataStart — absolute byte offset where data blocks begin
   * @param mixDb — optional hash-to-filename database
   * @returns filename → MixFileEntry map
   */
  private static _buildEntryMap(
    pkgEntries: PackageEntry[],
    dataStart: number,
    mixDb?: Map<string, string>,
  ): Map<string, MixFileEntry> {
    const entries = new Map<string, MixFileEntry>()

    for (const pkgEntry of pkgEntries) {
      const hexKey = '0x' + pkgEntry.hash.toString(16).toUpperCase().padStart(8, '0')
      let resolvedName: string

      if (mixDb) {
        const dbName = mixDb.get(hexKey)
        if (dbName) {
          resolvedName = dbName
        } else {
          resolvedName = `unresolved_${hexKey}.bin`
        }
      } else {
        resolvedName = `unresolved_${hexKey}.bin`
      }

      entries.set(resolvedName, {
        hash: pkgEntry.hash,
        offset: dataStart + pkgEntry.offset,
        size: pkgEntry.length,
      })
    }

    return entries
  }
}
