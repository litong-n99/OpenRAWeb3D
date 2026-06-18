/**
 * build-mods.ts — OpenRA mod data → web format build script
 *
 * 对应 TODO-22.E.1 / TODO-22.E.2 / TODO-22.E.3 / TODO-22.E.4
 *
 * 将 OpenRA mod.yaml + rules/weapons/sequences YAML 转换为
 * public/mods/{id}/mod.json + rules/*.json + weapons/*.json
 *
 * 用法: npx tsx scripts/build-mods.ts
 *
 * 前提:
 * - Node.js 内置 fs/path 模块
 * - 已有的 MiniYAML 管线 (src/utils/miniyaml-to-json.ts)
 * - 不引入新的 npm 运行时依赖
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { MiniYamlParser } from '../src/utils/miniyaml-to-json.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPENRA_MODS_DIR = path.resolve(import.meta.dirname, '..', 'OpenRA', 'mods')
const PUBLIC_MODS_DIR = path.resolve(import.meta.dirname, '..', 'public', 'mods')

/** Mod IDs and their corresponding OpenRA directory names */
const MOD_MAP: Record<string, ModDef> = {
  ra: { dir: 'ra', title: 'Red Alert', version: 'release-20250308', available: true },
  td: { dir: 'cnc', title: 'Tiberian Dawn', version: 'release-20250308', available: true },
  d2k: { dir: 'd2k', title: 'Dune 2000', version: 'release-20250308', available: true },
  ts: { dir: 'ts', title: 'Tiberian Sun', version: 'release-20250308', available: false },
}

interface ModDef {
  dir: string
  title: string
  version: string
  available: boolean
}

/** Top-level keys that should be arrays (value-list entries in MiniYAML) */
const VALUE_LIST_KEYS = new Set([
  'Rules', 'Sequences', 'ModelSequences', 'Cursors', 'Chrome', 'ChromeLayout',
  'Weapons', 'Voices', 'Notifications', 'Music', 'FluentMessages',
  'TileSets', 'ChromeMetrics', 'Missions', 'Hotkeys', 'ServerTraits',
])

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('[build-mods] Starting mod conversion...')
  console.log(`  Source: ${OPENRA_MODS_DIR}`)
  console.log(`  Target: ${PUBLIC_MODS_DIR}`)

  // Ensure output directories exist
  fs.mkdirSync(PUBLIC_MODS_DIR, { recursive: true })

  const indexEntries: IndexEntry[] = []

  for (const [modId, modDef] of Object.entries(MOD_MAP)) {
    console.log(`\n[build-mods] Processing mod: ${modId} (${modDef.dir})`)

    try {
      // 1. Read and parse mod.yaml
      const modYamlPath = path.join(OPENRA_MODS_DIR, modDef.dir, 'mod.yaml')
      if (!fs.existsSync(modYamlPath)) {
        console.warn(`  WARNING: mod.yaml not found at ${modYamlPath}, skipping.`)
        continue
      }

      const yamlContent = fs.readFileSync(modYamlPath, 'utf-8')
      const parser = new MiniYamlParser({ resolveInherits: false })
      const parsed = parser.parse(yamlContent) as Record<string, unknown>

      // 2. Transform to Manifest-compatible JSON
      const modJson = transformToModJson(modId, parsed, modDef)

      // 3. Write mod.json
      const modDir = path.join(PUBLIC_MODS_DIR, modId)
      fs.mkdirSync(modDir, { recursive: true })
      const modJsonPath = path.join(modDir, 'mod.json')
      fs.writeFileSync(modJsonPath, JSON.stringify(modJson, null, 2), 'utf-8')
      console.log(`  -> Wrote ${modJsonPath}`)

      // 4. Convert rules/weapons YAML to JSON
      await convertYamlAssets(modId, modDef, modDir)

      // 5. Collect index entry
      indexEntries.push({
        id: modId,
        title: modDef.title,
        version: modDef.version,
        description: extractDescription(modJson),
        factions: extractFactions(modId),
        thumbnail: '',
        background: '',
        available: modDef.available,
      })

    } catch (e) {
      console.error(`  ERROR processing ${modId}:`, e instanceof Error ? e.message : String(e))
    }
  }

  // 6. Generate _index.json
  const indexJson = { mods: indexEntries }
  const indexPath = path.join(PUBLIC_MODS_DIR, '_index.json')
  fs.writeFileSync(indexPath, JSON.stringify(indexJson, null, 2), 'utf-8')
  console.log(`\n[build-mods] -> Wrote ${indexPath}`)

  console.log('\n[build-mods] Done!')
}

// ---------------------------------------------------------------------------
// Transformation: MiniYAML parsed output → Manifest-compatible JSON
// ---------------------------------------------------------------------------

/**
 * Transform MiniYAML-parsed mod.yaml output into a Manifest-compatible
 * JSON object.
 *
 * Key transformations:
 * - VALUE_LIST_KEYS: convert from objects (key→null) to arrays
 * - FileSystem: simplify to mount-name keys
 * - Metadata: rename to Title/Version format, fill defaults
 * - RequiresMods: derive from manifests
 * - MapFolders: convert object to key-value map
 * - Strip Assemblies (C# only), SoundFormats, SpriteFormats, VideoFormats
 */
function transformToModJson(
  modId: string,
  parsed: Record<string, unknown>,
  modDef: ModDef,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  // ---- Metadata ----
  const metaRaw = (parsed['Metadata'] as Record<string, unknown>) ?? {}
  result['Metadata'] = {
    Title: String(metaRaw['Title'] ?? modDef.title),
    Version: String(metaRaw['Version'] ?? modDef.version),
    ...(metaRaw['Website'] !== undefined ? { Website: String(metaRaw['Website']) } : {}),
    ...(metaRaw['WebIcon32'] !== undefined ? { WebIcon32: String(metaRaw['WebIcon32']) } : {}),
    ...(metaRaw['WindowTitle'] !== undefined ? { WindowTitle: String(metaRaw['WindowTitle']) } : {}),
    Hidden: false,
  }

  // ---- RequiresMods ----
  // Derive from mod structure: all mods depend on 'common'
  result['RequiresMods'] = ['common']

  // ---- FileSystem ----
  result['FileSystem'] = buildFileSystem(parsed)

  // ---- Value-list keys: convert objects to arrays ----
  for (const key of VALUE_LIST_KEYS) {
    const raw = parsed[key]
    if (raw !== undefined && raw !== null) {
      result[key] = extractValueList(raw as Record<string, unknown>)
    } else {
      result[key] = []
    }
  }

  // ---- MapFolders ----
  const mapFoldersRaw = (parsed['MapFolders'] as Record<string, unknown>) ?? {}
  const mapFolders: Record<string, string> = {}
  for (const [k, v] of Object.entries(mapFoldersRaw)) {
    if (typeof v === 'string') {
      mapFolders[k] = v
    } else if (v === null) {
      mapFolders[k] = ''
    }
  }
  result['MapFolders'] = mapFolders

  // ---- SupportsMapsFrom ----
  if (typeof parsed['SupportsMapsFrom'] === 'string') {
    result['SupportsMapsFrom'] = parsed['SupportsMapsFrom']
  } else {
    result['SupportsMapsFrom'] = modId
  }

  // ---- LoadScreen ----
  if (parsed['LoadScreen'] && typeof parsed['LoadScreen'] === 'object') {
    result['LoadScreen'] = parsed['LoadScreen']
  }

  // ---- DefaultOrderGenerator ----
  if (typeof parsed['DefaultOrderGenerator'] === 'string') {
    result['DefaultOrderGenerator'] = parsed['DefaultOrderGenerator']
  }

  // ---- RendererConstants ----
  if (parsed['RendererConstants'] && typeof parsed['RendererConstants'] === 'object') {
    result['RendererConstants'] = parsed['RendererConstants']
  }

  // ---- PackageFormats ----
  result['PackageFormats'] = extractValueList(
    (parsed['PackageFormats'] as Record<string, unknown>) ?? {},
  )
  // Also handle the case where PackageFormats is a single string
  if (typeof parsed['PackageFormats'] === 'string') {
    result['PackageFormats'] = [parsed['PackageFormats']]
  }

  // ---- Pass through known but unmodified keys ----
  const passthroughKeys = [
    'Fonts', 'GameSpeeds', 'AssetBrowser', 'MapGrid',
    'AllowUnusedFluentMessagesInExternalPackages',
    'SoundFormats', 'SpriteFormats', 'VideoFormats',
    'TerrainFormat', 'SpriteSequenceFormat',
  ]
  for (const key of passthroughKeys) {
    if (parsed[key] !== undefined) {
      result[key] = mayUnwrapValue(parsed[key])
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// FileSystem transformation
// ---------------------------------------------------------------------------

/**
 * Build a simplified FileSystem object from the parsed mod.yaml FileSystem section.
 *
 * OpenRA's FileSystem section has type + SystemPackages + ContentPackages.
 * We extract mount-name keys from SystemPackages and ContentPackages.
 *
 * SystemPackages entries use syntax like:
 *   ^EngineDir               → key-only entry
 *   $ra: ra                  → key:value where value is the mount name
 *   ^EngineDir|mods/common: common  → key|path: mountname
 *   ~^SupportDir|Content/ra/v2/: content → optional mount
 */
function buildFileSystem(parsed: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {}

  const fsRaw = parsed['FileSystem']
  if (!fsRaw || typeof fsRaw !== 'object') return result

  const fsObj = fsRaw as Record<string, unknown>

  // Extract SystemPackages
  const sysPkgs = fsObj['SystemPackages']
  if (sysPkgs && typeof sysPkgs === 'object') {
    for (const [key, value] of Object.entries(sysPkgs as Record<string, unknown>)) {
      const mountName = extractMountName(key, value)
      if (mountName) {
        result[mountName] = 'folder'
      }
    }
  }

  // Extract ContentPackages
  const contentPkgs = fsObj['ContentPackages']
  if (contentPkgs && typeof contentPkgs === 'object') {
    for (const [key, value] of Object.entries(contentPkgs as Record<string, unknown>)) {
      const mountName = extractMountName(key, value)
      if (mountName) {
        result[mountName] = 'package'
      }
    }
  }

  return result
}

/**
 * Extract a clean mount name from a SystemPackage/ContentPackage entry.
 *
 * Entry format: "prefix|path: mountname" or "prefix|path" (value=null).
 * The mount name is either the value after ':' or the last segment after '|'.
 */
function extractMountName(key: string, value: unknown): string | null {
  // Strip optional '~' prefix
  let cleanKey = key.startsWith('~') ? key.slice(1) : key

  // Strip '^' prefix (EngineDir placeholder)
  cleanKey = cleanKey.startsWith('^') ? cleanKey.slice(1) : cleanKey

  // Strip '$' prefix (modid placeholder)
  cleanKey = cleanKey.startsWith('$') ? cleanKey.slice(1) : cleanKey

  // If value is a string, use it as the mount name
  if (typeof value === 'string' && value.length > 0) {
    return value
  }

  // Otherwise extract from key: use last segment after '|'
  if (cleanKey.includes('|')) {
    const segments = cleanKey.split('|')
    return segments[segments.length - 1] || null
  }

  // Single segment key
  return cleanKey.length > 0 ? cleanKey : null
}

// ---------------------------------------------------------------------------
// Value list extraction
// ---------------------------------------------------------------------------

/**
 * Convert a MiniYAML node object to an array of string values.
 *
 * In OpenRA MiniYAML, file lists are written as:
 *   Rules:
 *     ra|rules/misc.yaml
 *     ra|rules/ai.yaml
 *
 * The parser outputs these as: { "ra|rules/misc.yaml": null, "ra|rules/ai.yaml": null }
 * We need: ["ra|rules/misc.yaml", "ra|rules/ai.yaml"]
 *
 * If the node has a __value (meaning it had both value and children),
 * and children are key-only entries, extract the key names.
 */
function extractValueList(obj: Record<string, unknown>): string[] {
  // Handle case where the entire value is itself a { __value: ..., child1: null, ... }
  let entries = Object.entries(obj)

  // If there's __value, exclude it from the array
  entries = entries.filter(([k]) => k !== '__value')

  // For entries where value is an object with __value, extract the value text
  // For entries where value is null, the key IS the value
  const result: string[] = []
  for (const [key, value] of entries) {
    if (value === null || value === undefined || value === '') {
      result.push(key)
    } else if (typeof value === 'object' && value !== null) {
      const vObj = value as Record<string, unknown>
      if (vObj['__value'] !== undefined) {
        // Entry has explicit value: add "key: value" or just "value"
        result.push(String(vObj['__value']))
      } else {
        // Complex object: add key as-is (for backward compat)
        result.push(key)
      }
    } else if (typeof value === 'string') {
      result.push(value)
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// YAML asset conversion: rules, weapons, sequences
// ---------------------------------------------------------------------------

/**
 * Convert rules, weapons, and sequences YAML files to JSON.
 *
 * For each mod, reads the YAML files from OpenRA/mods/{dir}/{type}/*.yaml
 * and writes JSON to public/mods/{modId}/{type}/*.json
 */
async function convertYamlAssets(
  modId: string,
  modDef: ModDef,
  outputModDir: string,
): Promise<void> {
  const assetTypes = ['rules', 'weapons', 'sequences']

  for (const assetType of assetTypes) {
    const srcDir = path.join(OPENRA_MODS_DIR, modDef.dir, assetType)
    if (!fs.existsSync(srcDir)) {
      console.log(`  [${assetType}] No source directory at ${srcDir}, skipping.`)
      continue
    }

    const outDir = path.join(outputModDir, assetType)
    fs.mkdirSync(outDir, { recursive: true })

    const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.yaml'))
    let converted = 0

    for (const file of files) {
      const srcPath = path.join(srcDir, file)
      const outPath = path.join(outDir, file.replace(/\.yaml$/, '.json'))

      try {
        const yamlContent = fs.readFileSync(srcPath, 'utf-8')
        const parser = new MiniYamlParser({ resolveInherits: false })
        const parsed = parser.parse(yamlContent)
        fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2), 'utf-8')
        converted++
      } catch (e) {
        console.warn(`  [${assetType}] Failed to convert ${file}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    if (converted > 0) {
      console.log(`  [${assetType}] Converted ${converted} files -> ${outDir}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Index helpers
// ---------------------------------------------------------------------------

interface IndexEntry {
  id: string
  title: string
  version: string
  description: string
  factions: string[]
  thumbnail: string
  background: string
  available: boolean
}

function extractDescription(modJson: Record<string, unknown>): string {
  const meta = modJson['Metadata'] as Record<string, unknown> | undefined
  if (meta && typeof meta['Description'] === 'string') {
    return meta['Description']
  }
  return ''
}

function extractFactions(modId: string): string[] {
  switch (modId) {
    case 'ra': return ['Soviet', 'Allies']
    case 'td': return ['GDI', 'Nod']
    case 'd2k': return ['Atreides', 'Harkonnen', 'Ordos']
    case 'ts': return ['GDI', 'Nod']
    default: return []
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * If an object has a __value key, unwrap it. Otherwise return as-is.
 */
function mayUnwrapValue(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    if (obj['__value'] !== undefined) {
      return obj['__value']
    }
  }
  return value
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch((e) => {
  console.error('[build-mods] Fatal error:', e)
  process.exit(1)
})
