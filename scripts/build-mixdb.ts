/**
 * build-mixdb.ts — MIX filename hash database generator
 *
 * 对应 TODO-22.CI-A.10
 *
 * 从 OpenRA 内容安装器下载清单中提取所有 .mix 文件名，
 * 使用 Westwood Classic 哈希算法计算哈希值，
 * 生成 public/mods/_mixdb.json 供运行时 MIX 文件查找使用。
 *
 * C&C MIX 文件内部使用 CRC32 或 Classic 哈希存储文件名（而非真实文件名）。
 * 哈希数据库将哈希值映射回可读文件名。
 *
 * 用法: npx tsx scripts/build-mixdb.ts
 *
 * 前提:
 * - Node.js 内置 fs/path 模块
 * - 已有的 MiniYAML 管线 (src/utils/miniyaml-to-json.ts)
 * - 已有的 PackageEntry 哈希算法 (src/OpenRA.Mods.Cnc/FileSystem/PackageEntry.ts)
 *
 * OpenRA 对照:
 * - OpenRA.Mods.Cnc.UtilityCommands.XccGlobalDatabase
 * - OpenRA.Mods.Cnc.UtilityCommands.XccLocalDatabase
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { MiniYamlParser } from '../src/utils/miniyaml-to-json.ts'
import { PackageEntry, PackageHashType } from '../src/OpenRA.Mods.Cnc/FileSystem/PackageEntry.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPENRA_MODS_DIR = path.resolve(import.meta.dirname, '..', 'OpenRA', 'mods')
const PUBLIC_MODS_DIR = path.resolve(import.meta.dirname, '..', 'public', 'mods')

/**
 * Content installer mod directories to scan for download manifests.
 *
 * Each contains an installer/downloads.yaml with Extract sections
 * listing .mix filenames.
 */
const CONTENT_MOD_DIRS = [
  'ra-content',
  'cnc-content',
  'd2k-content',
  'ts-content',
]

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('[build-mixdb] Starting MIX hash database generation...')
  console.log(`  Source: ${OPENRA_MODS_DIR}`)
  console.log(`  Target: ${PUBLIC_MODS_DIR}`)

  fs.mkdirSync(PUBLIC_MODS_DIR, { recursive: true })

  /** Map from filename → list of mod dirs it was found in.
   *  Used to determine hash type (CRC32 for ts-content, Classic for others). */
  const allFilenames = new Map<string, string[]>()
  function addFilename(fn: string, modDir: string) {
    const existing = allFilenames.get(fn)
    if (existing) {
      if (!existing.includes(modDir)) existing.push(modDir)
    } else {
      allFilenames.set(fn, [modDir])
    }
  }

  // -----------------------------------------------------------------------
  // 1. Try to find files.yaml (common or mod-specific file lists)
  // -----------------------------------------------------------------------

  const commonFilesPath = path.join(OPENRA_MODS_DIR, 'common-content', 'files.yaml')
  if (fs.existsSync(commonFilesPath)) {
    console.log(`  Found common files list: ${commonFilesPath}`)
    const filenames = parseFilesYaml(commonFilesPath)
    for (const fn of filenames) addFilename(fn, '__common__')
    console.log(`  -> Added ${filenames.length} filenames from common-content/files.yaml`)
  } else {
    console.log('  No common-content/files.yaml found (expected for this OpenRA version).')
  }

  for (const modDir of CONTENT_MOD_DIRS) {
    const filesYamlPath = path.join(OPENRA_MODS_DIR, modDir, 'files.yaml')
    if (fs.existsSync(filesYamlPath)) {
      console.log(`  Found mod file list: ${filesYamlPath}`)
      const filenames = parseFilesYaml(filesYamlPath)
      for (const fn of filenames) addFilename(fn, modDir)
      console.log(`  -> Added ${filenames.length} filenames from ${modDir}/files.yaml`)
    }
  }

  // -----------------------------------------------------------------------
  // 2. If no files.yaml found, extract .mix filenames from download manifests
  // -----------------------------------------------------------------------

  if (allFilenames.size === 0) {
    console.log('  No files.yaml found. Extracting .mix filenames from download manifests...')

    for (const modDir of CONTENT_MOD_DIRS) {
      const downloadsPath = path.join(OPENRA_MODS_DIR, modDir, 'installer', 'downloads.yaml')
      if (!fs.existsSync(downloadsPath)) {
        console.warn(`  WARNING: downloads.yaml not found at ${downloadsPath}, skipping.`)
        continue
      }

      try {
        const yamlContent = fs.readFileSync(downloadsPath, 'utf-8')
        const parser = new MiniYamlParser({ resolveInherits: false })
        const parsed = parser.parse(yamlContent) as Record<string, unknown>

        const filenames = extractMixFilenames(parsed)
        for (const fn of filenames) addFilename(fn, modDir)
        console.log(`  -> Extracted ${filenames.length} filenames from ${modDir}/installer/downloads.yaml`)
      } catch (e) {
        console.warn(`  WARNING: Failed to parse ${downloadsPath}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  // -----------------------------------------------------------------------
  // 3. Compute hashes for all filenames
  // -----------------------------------------------------------------------

  console.log(`\n[build-mixdb] Computing hashes for ${allFilenames.size} unique filenames...`)

  const hashDb: Record<string, string> = {}

  for (const [filename, modDirs] of allFilenames) {
    // Determine primary mod dir (for hash type selection)
    const modDir = modDirs[0] ?? '__common__'

    // Hash the filename as-is with the primary hash type
    const hashHex = hashFilename(filename, modDir)
    hashDb[hashHex] = filename

    // For ts-content files, also add Classic hash as fallback
    // (CC MIX files may embed ts-content archive entries with Classic hashes)
    if (modDir === 'ts-content') {
      const classicHash = PackageEntry.hashFilename(filename, PackageHashType.Classic)
      const classicHex = '0x' + (classicHash >>> 0).toString(16).toUpperCase().padStart(8, '0')
      if (!(classicHex in hashDb)) {
        hashDb[classicHex] = filename
      }
    }

    // For non-ts-content files, also add CRC32 hash as fallback
    if (modDir !== 'ts-content') {
      const crc32Hash = PackageEntry.hashFilename(filename, PackageHashType.CRC32)
      const crc32Hex = '0x' + (crc32Hash >>> 0).toString(16).toUpperCase().padStart(8, '0')
      if (!(crc32Hex in hashDb)) {
        hashDb[crc32Hex] = filename
      }
    }

    // Also hash without the .mix extension (some references omit it)
    if (filename.toLowerCase().endsWith('.mix')) {
      const noExt = filename.slice(0, filename.length - 4)
      const noExtHash = hashFilename(noExt, modDir)
      // Only add if not already present (avoid overwriting)
      if (!(noExtHash in hashDb)) {
        hashDb[noExtHash] = noExt
      }
    }
  }

  // -----------------------------------------------------------------------
  // 4. Write _mixdb.json
  // -----------------------------------------------------------------------

  const outputPath = path.join(PUBLIC_MODS_DIR, '_mixdb.json')
  fs.writeFileSync(outputPath, JSON.stringify(hashDb, null, 2), 'utf-8')
  console.log(`\n[build-mixdb] -> Wrote ${outputPath} (${Object.keys(hashDb).length} hash entries)`)
  console.log('[build-mixdb] Done!')
}

// ---------------------------------------------------------------------------
// Hash function (Classic Westwood hash, matching PackageEntry)
// ---------------------------------------------------------------------------

/**
 * Compute the Westwood filename hash as a hex string.
 *
 * OpenRA 对照: PackageEntry.hashFilename(filename, PackageHashType)
 *
 * Uses different hash types for different content mods:
 * - cnc-content, ra-content, d2k-content: Classic (like TD/RA1/Dune)
 * - ts-content: CRC32 (Tiberian Sun and RA2 use CRC32 in MIX files)
 *
 * The hash value is converted to the "0x" uppercase hex format
 * used in _mixdb.json keys.
 *
 * @param filename — Filename to hash (case-insensitive)
 * @param modDir — Content mod directory name (e.g. "ts-content", "ra-content")
 * @returns Hash as hex string like "0x12ABCDEF"
 */
function hashFilename(filename: string, modDir: string): string {
  const hashType = modDir === 'ts-content' ? PackageHashType.CRC32 : PackageHashType.Classic
  const hash = PackageEntry.hashFilename(filename, hashType)
  return '0x' + (hash >>> 0).toString(16).toUpperCase().padStart(8, '0')
}

// ---------------------------------------------------------------------------
// YAML extraction helpers
// ---------------------------------------------------------------------------

/**
 * Parse a files.yaml file (if it exists) to extract filename entries.
 *
 * A files.yaml would contain a simple list of filenames:
 *   files:
 *     allies.mix
 *     conquer.mix
 *     ...
 *
 * This is a fallback; in practice these files may not exist.
 */
function parseFilesYaml(yamlPath: string): string[] {
  const filenames: string[] = []

  try {
    const content = fs.readFileSync(yamlPath, 'utf-8')
    const parser = new MiniYamlParser({ resolveInherits: false })
    const parsed = parser.parse(content) as Record<string, unknown>

    // Look for a 'files' key or try top-level entries
    const filesRaw = parsed['files'] ?? parsed
    if (filesRaw && typeof filesRaw === 'object') {
      const filesObj = filesRaw as Record<string, unknown>
      for (const [key, value] of Object.entries(filesObj)) {
        if (key === '__value') continue
        // If value is null, the key IS the filename
        // If value is a string with leading path tokens, extract just the filename
        if (value === null || value === undefined) {
          filenames.push(simplifyFilename(key))
        } else if (typeof value === 'string') {
          filenames.push(simplifyFilename(value))
        }
      }
    }
  } catch (e) {
    console.warn(`  WARNING: Failed to parse ${yamlPath}: ${e instanceof Error ? e.message : String(e)}`)
  }

  return filenames
}

/**
 * Extract all .mix filenames from a parsed downloads.yaml manifest.
 *
 * Scans all Extract sections in all packages to find filenames.
 * Looks for filenames that end with .mix (case-insensitive).
 *
 * @param parsed — Parsed downloads.yaml content
 * @returns Array of unique .mix filenames
 */
function extractMixFilenames(parsed: Record<string, unknown>): string[] {
  const filenames = new Set<string>()

  for (const [pkgKey, pkgValue] of Object.entries(parsed)) {
    if (pkgKey === '__value' || pkgValue === null || typeof pkgValue !== 'object') continue

    const pkgObj = pkgValue as Record<string, unknown>
    const extractRaw = pkgObj['Extract']

    if (!extractRaw || typeof extractRaw !== 'object') continue

    const extractObj = extractRaw as Record<string, unknown>
    for (const [destPath, sourcePath] of Object.entries(extractObj)) {
      if (destPath === '__value') continue

      // Try both the destPath (simplified) and sourcePath as potential filenames
      const srcFilename = typeof sourcePath === 'string' ? sourcePath : String(sourcePath ?? '')
      const simplifiedSrc = simplifyFilename(srcFilename)

      if (isMixFile(simplifiedSrc)) {
        filenames.add(simplifiedSrc)
      }

      // Also check the destPath for .mix files
      const simplifiedDest = simplifyFilename(destPath)
      if (isMixFile(simplifiedDest) && simplifiedDest !== simplifiedSrc) {
        filenames.add(simplifiedDest)
      }
    }
  }

  return Array.from(filenames).sort()
}

/**
 * Simplify a path to just the filename portion.
 *
 * Strips path tokens (^, $, |) and directory prefixes.
 *
 * @param raw — Raw path string potentially containing tokens
 * @returns Just the filename portion
 */
function simplifyFilename(raw: string): string {
  let result = raw

  // Strip optional '~' prefix
  if (result.startsWith('~')) {
    result = result.slice(1)
  }
  // Strip '^' prefix
  if (result.startsWith('^')) {
    result = result.slice(1)
  }
  // Strip '$' token
  if (result.startsWith('$')) {
    result = result.slice(1)
  }

  // Handle '|' token separators (e.g., "^SupportDir|Content/ra/v2/allies.mix")
  if (result.includes('|')) {
    const segments = result.split('|')
    result = segments[segments.length - 1] || result
  }

  // Handle ':' separators (from key:value format)
  if (result.includes(':')) {
    const colonIdx = result.indexOf(':')
    const afterColon = result.slice(colonIdx + 1).trim()
    if (afterColon.length > 0) {
      result = afterColon
    } else {
      result = result.slice(0, colonIdx).trim()
    }
  }

  // Extract just the filename from a full path (e.g., "v2/allies.mix" → "allies.mix")
  if (result.includes('/')) {
    result = result.split('/').pop() ?? result
  }
  if (result.includes('\\')) {
    result = result.split('\\').pop() ?? result
  }

  return result.trim()
}

/** Check if a filename ends with .mix (case-insensitive). */
function isMixFile(filename: string): boolean {
  return filename.toLowerCase().endsWith('.mix')
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch((e) => {
  console.error('[build-mixdb] Fatal error:', e)
  process.exit(1)
})
