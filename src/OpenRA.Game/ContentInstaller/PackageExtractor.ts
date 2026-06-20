/**
 * PackageExtractor.ts — ZIP 解压 + 子归档递归解包
 * OpenRA 对照: OpenRA.Mods.Common/ModContent.cs (extraction logic)
 *             + OpenRA.Game/FileSystem/ZipFile.cs (ZIP decompression)
 *
 * 核心范式转换:
 * - C# ZipFile.Extract (SharpZipLib) → fflate unzipSync
 * - C# 文件系统写入 (SupportDir/Content/) → 内存 Map<string, ArrayBuffer>
 * - C# 子归档递归 (MIX/Pak/BIG/MEG) → 委托给对应的 IPackageLoader
 * - C# 同步文件 I/O → 异步 extract()（所有 open() 均为 async）
 * - C# 进度回调 EventHandler → onProgress 回调
 */

import { unzipSync } from 'fflate'
import { MixFileRuntime } from '../../OpenRA.Mods.Cnc/FileSystem/MixFileRuntime.js'
import { PakFileLoader } from '../../OpenRA.Mods.Cnc/FileSystem/Pak.js'
import { BigFileLoader } from '../../OpenRA.Mods.Cnc/FileSystem/BigFile.js'
import { MegV3Loader } from '../../OpenRA.Mods.Cnc/FileSystem/MegFile.js'
import type { IReadOnlyPackage } from '../FileSystem/IPackage.js'

// ---------------------------------------------------------------------------
// Module-level loader singletons (stateless, reusable across calls)
// ---------------------------------------------------------------------------

const _pakLoader = new PakFileLoader()
const _bigLoader = new BigFileLoader()
const _megLoader = new MegV3Loader()

// ---------------------------------------------------------------------------
// PackageExtractor
// ---------------------------------------------------------------------------

/**
 * Extracts files from a downloaded ZIP archive, recursively unpacking
 * sub-archive formats (MIX, PAK, BIG, MEG) found within.
 *
 * OpenRA 对照: ModContent.ExtractFiles() + ZipFile.GetStream()
 *
 * The extraction pipeline:
 * 1. Decompress the ZIP using fflate unzipSync
 * 2. For each {destPath: zipEntryPath} in extractMap:
 *    a. Locate zipEntryPath in the decompressed contents
 *    b. Determine file type by extension
 *    c. If sub-archive (.mix/.pak/.big/.meg): recursively unpack inner files
 *    d. Otherwise: pass through raw bytes
 * 3. Return all extracted files as a Map of filename → ArrayBuffer
 *
 * ## Sub-archive naming convention
 *
 * When a MIX/PAK/BIG/MEG archive is encountered, its inner files are added
 * to the result map with keys formed as `{destPath}/{innerFilename}`.
 * For example, if the extractMap maps `"Content/ra/v2/allies.mix"` to
 * `"allies.mix"` in the ZIP, and allies.mix contains `e1.shp`, the result
 * key is `"Content/ra/v2/allies.mix/e1.shp"`.
 */
export class PackageExtractor {
  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Extract files from a ZIP buffer according to an extractMap.
   *
   * OpenRA 对照: ModContent.ExtractFiles() (decompression + extraction)
   *
   * @param zipBuffer — the downloaded ZIP file as ArrayBuffer
   * @param extractMap — map of {destPath: archiveEntryPath} from ContentDownload.extract
   * @param mixDb — optional MIX hash database for .mix filename resolution
   * @param onProgress — progress callback.
   *   Called with (entryPath: string, current: number, total: number).
   *   On completion the entryPath is the sentinel string `'__done__'`.
   * @returns Map of filename → ArrayBuffer for all extracted files
   * @throws Error if a required archive entry is not found in the ZIP
   */
  async extract(
    zipBuffer: ArrayBuffer,
    extractMap: Record<string, string>,
    mixDb?: Map<string, string>,
    onProgress?: (entry: string, current: number, total: number) => void,
  ): Promise<Map<string, ArrayBuffer>> {
    const result = new Map<string, ArrayBuffer>()

    // Step 1: Decompress ZIP
    let unzipped: Record<string, Uint8Array>
    try {
      unzipped = unzipSync(new Uint8Array(zipBuffer))
    } catch (err) {
      throw new Error(`PackageExtractor: Failed to decompress ZIP: ${String(err)}`)
    }

    // Step 2: Process each extractMap entry
    const entries = Object.entries(extractMap)
    const total = entries.length

    for (let i = 0; i < total; i++) {
      const [destPath, zipEntryPath] = entries[i]

      // Report progress
      if (onProgress) {
        onProgress(zipEntryPath, i, total)
      }

      // Locate the ZIP entry
      const zipEntry = unzipped[zipEntryPath]
      if (!zipEntry) {
        throw new Error(
          `PackageExtractor: Archive entry not found: "${zipEntryPath}" ` +
          `(mapped from dest "${destPath}")`,
        )
      }

      const entryData = new Uint8Array(
        zipEntry.buffer.slice(zipEntry.byteOffset, zipEntry.byteOffset + zipEntry.byteLength),
      )

      // Determine file type by extension
      const lower = destPath.toLowerCase()
      const lowerZip = zipEntryPath.toLowerCase()

      if (lower.endsWith('.mix') || lowerZip.endsWith('.mix')) {
        // MIX sub-archive — recursively unpack
        const innerFiles = await this._extractSubPackage(
          'mix', entryData.buffer as ArrayBuffer, destPath, mixDb,
        )
        for (const [innerName, innerData] of innerFiles) {
          result.set(innerName, innerData)
        }
      } else if (lower.endsWith('.pak') || lowerZip.endsWith('.pak')) {
        // PAK sub-archive
        const innerFiles = await this._extractSubPackage(
          'pak', entryData.buffer as ArrayBuffer, destPath, mixDb,
        )
        for (const [innerName, innerData] of innerFiles) {
          result.set(innerName, innerData)
        }
      } else if (lower.endsWith('.big') || lowerZip.endsWith('.big')) {
        // BIG sub-archive
        const innerFiles = await this._extractSubPackage(
          'big', entryData.buffer as ArrayBuffer, destPath, mixDb,
        )
        for (const [innerName, innerData] of innerFiles) {
          result.set(innerName, innerData)
        }
      } else if (lower.endsWith('.meg') || lowerZip.endsWith('.meg')) {
        // MEG sub-archive
        const innerFiles = await this._extractSubPackage(
          'meg', entryData.buffer as ArrayBuffer, destPath, mixDb,
        )
        for (const [innerName, innerData] of innerFiles) {
          result.set(innerName, innerData)
        }
      } else if (lower.endsWith('.tem') || lowerZip.endsWith('.tem')) {
        // .tem terrain tileset — pass through as raw bytes for runtime parsing
        // TODO-CI-C.5: Add TemTileset.parse() integration if on-the-fly tile extraction is needed
        result.set(destPath, entryData.buffer.slice(
          entryData.byteOffset,
          entryData.byteOffset + entryData.byteLength,
        ) as ArrayBuffer)
      } else {
        // Pass through as raw bytes
        result.set(destPath, entryData.buffer.slice(
          entryData.byteOffset,
          entryData.byteOffset + entryData.byteLength,
        ) as ArrayBuffer)
      }
    }

    // Report completion with '__done__' sentinel.
    // Callers use this to detect the end of an extraction batch
    // (the sentinel string will never match a real zip entry path).
    if (onProgress) {
      onProgress('__done__', total, total)
    }

    return result
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Extract all files from a sub-archive (MIX, PAK, BIG, or MEG).
   *
   * Parses the sub-archive data into an IReadOnlyPackage, then iterates
   * through its contents and reads each file. Inner files are keyed as
   * `{destPath}/{innerFilename}`.
   *
   * @param format — sub-archive format identifier
   * @param data — raw sub-archive data
   * @param destPath — the destination path prefix for inner file keys
   * @param mixDb — optional MIX hash database
   * @returns map of inner filename → ArrayBuffer
   */
  private async _extractSubPackage(
    format: 'mix' | 'pak' | 'big' | 'meg',
    data: ArrayBuffer,
    destPath: string,
    mixDb?: Map<string, string>,
  ): Promise<Map<string, ArrayBuffer>> {
    let pkg: IReadOnlyPackage | null = null

    try {
      if (format === 'mix') {
        // Try encrypted format first (RA/TS/RA2 with Blowfish/RSA),
        // then fall back to unencrypted C&C format,
        // then fall back to Westwood classic format.
        if (MixFileRuntime.isEncryptedFormat(data)) {
          try {
            pkg = MixFileRuntime.parseEncrypted(destPath, data, undefined, mixDb)
          } catch (encryptedErr) {
            console.warn(
              `PackageExtractor: encrypted MIX parse failed for "${destPath}": ` +
              `${encryptedErr instanceof Error ? encryptedErr.message : String(encryptedErr)}`,
            )
            // Fallthrough: try Westwood classic as a fallback.
            // Some CDN files (e.g., scores.mix) have the encrypted flag set
            // spuriously (secondUint16 bit 1) but are actually unencrypted
            // Westwood classic format.
            if (MixFileRuntime.isWestwoodClassicFormat(data)) {
              try {
                pkg = MixFileRuntime.parseWestwoodClassic(destPath, data, mixDb)
                console.warn(
                  `PackageExtractor: "${destPath}" fell through from encrypted ` +
                  `to Westwood classic MIX parse`,
                )
              } catch (_fallbackErr) {
                // Both parseEncrypted and parseWestwoodClassic failed;
                // pkg stays null and we continue to the next format check.
              }
            }
          }
        }
        if (!pkg && MixFileRuntime.isCncFormat(data)) {
          try {
            pkg = MixFileRuntime.parse(destPath, data, mixDb)
          } catch (err) {
            console.warn(
              `PackageExtractor: C&C MIX parse failed for "${destPath}": ` +
              `${err instanceof Error ? err.message : String(err)}`,
            )
          }
        }
        if (!pkg && MixFileRuntime.isWestwoodClassicFormat(data)) {
          try {
            pkg = MixFileRuntime.parseWestwoodClassic(destPath, data, mixDb)
          } catch (err) {
            console.warn(
              `PackageExtractor: Westwood classic MIX parse failed for "${destPath}": ` +
              `${err instanceof Error ? err.message : String(err)}`,
            )
          }
        }
        if (!pkg && !MixFileRuntime.isEncryptedFormat(data) && !MixFileRuntime.isCncFormat(data) && !MixFileRuntime.isWestwoodClassicFormat(data)) {
          // Not a recognized MIX format — log diagnostic info
          const dv = new DataView(data)
          const first = dv.getUint16(0, true)
          const second = data.byteLength >= 4 ? dv.getUint16(2, true) : 0
          console.warn(
            `PackageExtractor: "${destPath}" is not a recognized MIX format ` +
            `(firstUint16=0x${first.toString(16).padStart(4, '0')}, ` +
            `secondUint16=0x${second.toString(16).padStart(4, '0')}, size=${data.byteLength})`,
          )
        }

        // Enrich the mix database from the MIX's own local database entry.
        // This logs the enrichment count for diagnostic purposes.
        // NOTE: PackageExtractor receives mixDb as a parameter (not a shared
        // cache), so cross-pollination between extractions is limited.
        // The MixLoader handles cross-pollination via its own setMixDb() mechanism.
        if (pkg instanceof MixFileRuntime) {
          const enrichedDb = MixFileRuntime.buildMixDb(data, pkg.getEntries(), mixDb)
          if (enrichedDb.size > 0) {
            console.log(
              `PackageExtractor: enriched ${enrichedDb.size} filenames ` +
              `from "${destPath}" local database`,
            )
          }
        }
      } else if (format === 'pak') {
        pkg = _pakLoader.tryParsePackage(destPath, data)
      } else if (format === 'big') {
        pkg = _bigLoader.tryParsePackage(destPath, data)
      } else if (format === 'meg') {
        pkg = _megLoader.tryParsePackage(destPath, data)
      }

      if (!pkg) {
        // Loader couldn't parse the data — treat as raw bytes pass-through
        console.warn(
          `PackageExtractor: could not parse "${destPath}" as ${format}, ` +
          `passing through as raw bytes`,
        )
        const result = new Map<string, ArrayBuffer>()
        result.set(destPath, data.slice(0) as ArrayBuffer)
        return result
      }

      const result = new Map<string, ArrayBuffer>()
      for (const filename of pkg.contents) {
        const fileData = await pkg.open(filename)
        if (fileData) {
          const innerKey = `${destPath}/${filename}`
          result.set(innerKey, fileData)
        }
      }

      // Dispose the sub-package to release its internal buffer references
      pkg.dispose()

      return result
    } catch (err) {
      // If sub-package parsing fails, dispose and pass through as raw bytes
      console.warn(
        `PackageExtractor: error extracting "${destPath}" as ${format}: ` +
        `${String(err)}, passing through as raw bytes`,
      )
      if (pkg) {
        try { pkg.dispose() } catch { /* ignore dispose errors */ }
      }
      const result = new Map<string, ArrayBuffer>()
      result.set(destPath, data.slice(0) as ArrayBuffer)
      return result
    }
  }
}
