/**
 * MixFileRuntime.ts — Runtime C&C-format MIX file parser
 * OpenRA 对照: OpenRA.Mods.Cnc/FileSystem/MixFile.cs (MixLoader.MixFile)
 *
 * 核心范式转换:
 * - C# Stream + seek → DataView + ArrayBuffer offset-based access
 * - C# Blowfish/RSA decryption → not supported (Phase A: C&C unencrypted only)
 * - C# SegmentStream (lazy, shared buffer) → ArrayBuffer.slice() (eager independent copy)
 * - C# global mix database (XccGlobalDatabase) → optional mixDb Map<string, string>
 * - C# tryParsePackage returns MixFile → MixFileRuntime.parse() static factory
 * - C# Dictionary<uint, PackageEntry> index → Map<string, MixFileEntry> with pre-resolved names
 *
 * NOTE: Phase A scope is C&C format (unencrypted) only. Encrypted RA/TS/RA2 format
 * is deferred to Phase B per the task specification. The `isCncFormat()` method
 * detects the format by checking that the first uint16 (numFiles) is non-zero.
 */

import type { IReadOnlyPackage, IReadOnlyFileSystem } from '../../OpenRA.Game/FileSystem/IPackage.js'
import { PackageEntry } from './PackageEntry.js'

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
        `Encrypted MIX files are not supported in Phase A.`,
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

    // Resolve filenames and build internal entry map
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

      // Handle duplicate filenames: keep last (overwrite).
      // This matches OpenRA's ToDictionaryWithConflictLog which logs a warning
      // but keeps the last value. We omit the log for simplicity.
      const absoluteOffset = dataStart + pkgEntry.offset
      entries.set(resolvedName, {
        hash: pkgEntry.hash,
        offset: absoluteOffset,
        size: pkgEntry.length,
      })
    }

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
}
