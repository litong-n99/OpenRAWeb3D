/**
 * build-content.ts — OpenRA content installer YAML → web JSON manifest
 *
 * 对应 TODO-22.CI-A.9
 *
 * 将 OpenRA/mods/*-content/installer/downloads.yaml 转换为
 * public/mods/{contentModId}/content.json，供 ContentInstallerService
 * 在运行时使用。
 *
 * 用法: npx tsx scripts/build-content.ts
 *
 * 前提:
 * - Node.js 内置 fs/path 模块
 * - 已有的 MiniYAML 管线 (src/utils/miniyaml-to-json.ts)
 * - ContentInstallerTypes (src/OpenRA.Game/ContentInstaller/ContentInstallerTypes.ts)
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { MiniYamlParser } from '../src/utils/miniyaml-to-json.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPENRA_MODS_DIR = path.resolve(import.meta.dirname, '..', 'OpenRA', 'mods')
const PUBLIC_MODS_DIR = path.resolve(import.meta.dirname, '..', 'public', 'mods')

/**
 * Content installer mod ID → target mod ID + OpenRA directory name mapping.
 *
 * The content installer YAML files live in:
 *   OpenRA/mods/{dir}/installer/downloads.yaml
 *
 * The web output goes to:
 *   public/mods/{contentModId}/content.json
 *
 * The targetModId is the game mod this content is for:
 *   ra-content → ra, cnc-content → td, d2k-content → d2k, ts-content → ts
 */
const CONTENT_MOD_MAP: Record<string, { dir: string; targetModId: string }> = {
  'ra-content': { dir: 'ra-content', targetModId: 'ra' },
  'cnc-content': { dir: 'cnc-content', targetModId: 'td' },
  'd2k-content': { dir: 'd2k-content', targetModId: 'd2k' },
  'ts-content': { dir: 'ts-content', targetModId: 'ts' },
}

// ---------------------------------------------------------------------------
// Types (mirrored from ContentInstallerTypes.ts — defined inline for
// build-time use to avoid browser-only import issues)
// ---------------------------------------------------------------------------

interface ModContentManifest {
  modId: string
  targetModId: string
  packages: Record<string, ContentPackage>
  downloads: Record<string, ContentDownload>
  sources?: Record<string, ContentSource>
}

interface ContentPackage {
  title: string
  identifier: string
  testFiles: string[]
  sources: string[]
  required: boolean
  download: string
}

interface ContentDownload {
  title: string
  url?: string
  mirrorList?: string
  sha1: string
  type: string
  extract: Record<string, string>
}

interface ContentSource {
  title: string
  type?: string
  idFiles?: Record<string, string>
  install?: Record<string, string>
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('[build-content] Starting content manifest generation...')
  console.log(`  Source: ${OPENRA_MODS_DIR}`)
  console.log(`  Target: ${PUBLIC_MODS_DIR}`)

  fs.mkdirSync(PUBLIC_MODS_DIR, { recursive: true })

  for (const [contentModId, { dir, targetModId }] of Object.entries(CONTENT_MOD_MAP)) {
    const yamlPath = path.join(OPENRA_MODS_DIR, dir, 'installer', 'downloads.yaml')

    if (!fs.existsSync(yamlPath)) {
      console.warn(`  WARNING: downloads.yaml not found at ${yamlPath}, skipping ${contentModId}.`)
      continue
    }

    console.log(`\n[build-content] Processing ${contentModId}...`)

    try {
      // 1. Read and parse downloads.yaml
      const yamlContent = fs.readFileSync(yamlPath, 'utf-8')
      const parser = new MiniYamlParser({ resolveInherits: false })
      const parsed = parser.parse(yamlContent) as Record<string, unknown>

      // 2. Transform to ModContentManifest
      const manifest = transformToManifest(parsed, contentModId, targetModId)

      // 3. Write content.json
      const outputDir = path.join(PUBLIC_MODS_DIR, contentModId)
      fs.mkdirSync(outputDir, { recursive: true })
      const outputPath = path.join(outputDir, 'content.json')
      fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2), 'utf-8')

      const pkgCount = Object.keys(manifest.packages).length
      const dlCount = Object.keys(manifest.downloads).length
      console.log(`  -> Wrote ${outputPath} (${pkgCount} packages, ${dlCount} downloads)`)
    } catch (e) {
      console.error(`  ERROR processing ${contentModId}:`, e instanceof Error ? e.message : String(e))
    }
  }

  console.log('\n[build-content] Done!')
}

// ---------------------------------------------------------------------------
// Transformation: MiniYAML parsed output → ModContentManifest JSON
// ---------------------------------------------------------------------------

/**
 * Transform MiniYAML-parsed downloads.yaml output into a ModContentManifest.
 *
 * The YAML format for each mod's downloads.yaml:
 *
 *   packageId: Human-Readable Title
 *     Type: ZipFile
 *     SHA1: <hex hash>
 *     MirrorList: <url>
 *     URL: <url>  (optional, for direct downloads)
 *     Extract:
 *       ^SupportDir|Content/{mod}/path/file.ext: zip_entry_path
 *
 * This produces:
 * - packages: Record of ContentPackage keyed by identifier
 * - downloads: Record of ContentDownload keyed by identifier
 */
function transformToManifest(
  parsed: Record<string, unknown>,
  contentModId: string,
  targetModId: string,
): ModContentManifest {
  const packages: Record<string, ContentPackage> = {}
  const downloads: Record<string, ContentDownload> = {}

  for (const [key, rawValue] of Object.entries(parsed)) {
    // Skip __value (parser internals at top level) and non-object entries
    if (key === '__value' || rawValue === null || typeof rawValue !== 'object') continue

    const pkgObj = rawValue as Record<string, unknown>

    // Identifier: the key itself (e.g. "quickinstall", "basefiles")
    const identifier = key

    // Title: the __value or fallback to the key itself
    const title = typeof pkgObj['__value'] === 'string'
      ? pkgObj['__value']
      : (typeof pkgObj['Title'] === 'string' ? pkgObj['Title'] : identifier)

    // Required flag: entries with `~` prefix are optional
    // NOTE: Key doesn't have `~` in parsed output (MiniYAML strips it).
    // Instead check if __optional flag was set, or infer from the
    // original key format. For OpenRA content, all entries are required
    // unless the original key starts with '~'.
    // Since MiniYAMLParser may or may not preserve this, we check both.
    const required = !key.startsWith('~') && pkgObj['__optional'] !== true

    // Extract → testFiles + extract map
    const extractRaw = pkgObj['Extract'] as Record<string, unknown> | undefined
    const extractMap: Record<string, string> = {}
    const testFiles: string[] = []

    if (extractRaw && typeof extractRaw === 'object') {
      for (const [destPath, sourcePath] of Object.entries(extractRaw)) {
        // Skip __value
        if (destPath === '__value') continue

        const simplifiedKey = simplifyDestPath(destPath)
        const value = typeof sourcePath === 'string' ? sourcePath : String(sourcePath ?? '')
        extractMap[simplifiedKey] = value
        testFiles.push(simplifiedKey)
      }
    }

    // Build ContentPackage
    const pkg: ContentPackage = {
      title,
      identifier,
      testFiles,
      sources: [],
      required,
      download: identifier, // download key matches the package identifier
    }
    packages[identifier] = pkg

    // Build ContentDownload
    const dl: ContentDownload = {
      title,
      sha1: typeof pkgObj['SHA1'] === 'string' ? pkgObj['SHA1'] : '',
      type: typeof pkgObj['Type'] === 'string' ? pkgObj['Type'] : 'ZipFile',
      extract: extractMap,
    }

    if (typeof pkgObj['MirrorList'] === 'string') {
      dl.mirrorList = pkgObj['MirrorList']
    }

    if (typeof pkgObj['URL'] === 'string') {
      dl.url = pkgObj['URL']
    }

    downloads[identifier] = dl
  }

  return {
    modId: contentModId,
    targetModId,
    packages,
    downloads,
  }
}

// ---------------------------------------------------------------------------
// Path simplification
// ---------------------------------------------------------------------------

/**
 * Simplify an OpenRA destPath to a web-friendly relative path.
 *
 * OpenRA YAML uses path tokens like:
 *   ^SupportDir|Content/ra/v2/allies.mix
 *   ^EngineDir|mods/common/rules.yaml
 *   $ra: ra
 *
 * For web manifests, strip the token prefix and normalize:
 *   "Content/ra/v2/allies.mix" (keep as-is for ContentInstaller mount paths)
 *
 * The simplified path preserves the Content/{mod}/... structure so the
 * runtime ContentInstallerService can map to the correct mount point.
 *
 * @param rawKey — Raw destPath from YAML (may contain ^, $, | tokens)
 * @returns Simplified relative path
 */
function simplifyDestPath(rawKey: string): string {
  let result = rawKey

  // Strip optional '~' prefix (optional mount)
  if (result.startsWith('~')) {
    result = result.slice(1)
  }

  // Strip '^' prefix (EngineDir/SupportDir placeholder)
  if (result.startsWith('^')) {
    result = result.slice(1)
  }

  // Strip leading '$' token (modid placeholder like "$ra")
  if (result.startsWith('$')) {
    result = result.slice(1)
  }

  // Split on '|' — the last segment after the final '|' is the relative path
  if (result.includes('|')) {
    const segments = result.split('|')
    result = segments[segments.length - 1] || result
  }

  // Handle "key: value" format (from ContentPackages style entries)
  // The key before ':' is the token, after ':' is the real path
  if (result.includes(':')) {
    const colonIdx = result.indexOf(':')
    const afterColon = result.slice(colonIdx + 1).trim()
    if (afterColon.length > 0) {
      result = afterColon
    } else {
      result = result.slice(0, colonIdx).trim()
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch((e) => {
  console.error('[build-content] Fatal error:', e)
  process.exit(1)
})
