/**
 * build-chrome.ts — OpenRA chrome YAML → JSON build script
 * OpenRA 对照: (无直接对应，新构建工具)
 *
 * 核心范式转换:
 * - OpenRA chrome YAML (widget layouts + chrome definitions) → JSON at build time
 * - MiniYamlParser 处理继承 (^ 前缀 overlay) 和嵌套结构
 *
 * 输入:  OpenRA/mods/{mod}/chrome/*.yaml (widget layouts)
 *        OpenRA/mods/{mod}/chrome.yaml   (chrome definitions, if present)
 * 输出:  public/mods/{modId}/chrome/*.json
 *        public/mods/{modId}/chrome.json
 *
 * 用法: npx tsx scripts/build-chrome.ts [--mod=ra]
 *       不带参数时处理所有 known mods
 *
 * 注意: common mod 没有 mod.yaml，chrome/ 目录单独处理
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { MiniYamlParser } from '../src/utils/miniyaml-to-json.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPENRA_MODS_DIR = path.resolve(import.meta.dirname, '..', 'OpenRA', 'mods')
const PUBLIC_MODS_DIR = path.resolve(import.meta.dirname, '..', 'public', 'mods')

/** Mod IDs mapping for mods with chrome assets. */
const CHROME_MODS: Array<{ modId: string; modDir: string }> = [
  { modId: 'common', modDir: 'common' },
  { modId: 'ra', modDir: 'ra' },
  { modId: 'td', modDir: 'cnc' },
  { modId: 'd2k', modDir: 'd2k' },
  { modId: 'ts', modDir: 'ts' },
]

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Parse optional --mod= argument for single-mod mode
  const modArg = process.argv.find(a => a.startsWith('--mod='))
  const filterMod = modArg ? modArg.split('=')[1] : null

  console.log('[build-chrome] Starting chrome YAML → JSON conversion...')
  console.log(`  Source: ${OPENRA_MODS_DIR}`)
  console.log(`  Target: ${PUBLIC_MODS_DIR}`)

  let totalConverted = 0

  for (const { modId, modDir } of CHROME_MODS) {
    if (filterMod && modId !== filterMod) continue

    const srcChromeDir = path.join(OPENRA_MODS_DIR, modDir, 'chrome')
    const srcChromeYaml = path.join(OPENRA_MODS_DIR, modDir, 'chrome.yaml')
    const hasChromeDir = fs.existsSync(srcChromeDir)
    const hasChromeYaml = fs.existsSync(srcChromeYaml)

    if (!hasChromeDir && !hasChromeYaml) {
      console.log(`\n[build-chrome] Mod '${modId}': no chrome assets, skipping.`)
      continue
    }

    console.log(`\n[build-chrome] Processing mod: ${modId}${modDir !== modId ? ` (dir: ${modDir})` : ''}`)

    const converted = convertChromeForMod(modDir, modId)
    totalConverted += converted
  }

  console.log(`\n[build-chrome] Done! Total: ${totalConverted} files converted.`)
}

// ---------------------------------------------------------------------------
// Public API (exported for use by build-mods.ts)
// ---------------------------------------------------------------------------

/**
 * Convert all chrome assets for a given mod.
 *
 * Call this from build-mods.ts to integrate chrome conversion into the
 * build pipeline. Handles both:
 * 1. Top-level chrome.yaml → chrome.json
 * 2. chrome/ directory *.yaml → chrome/*.json
 *
 * @param modDir — OpenRA mod directory name (e.g., 'ra', 'cnc', 'common')
 * @param modId  — Target mod ID for output (e.g., 'ra', 'td', 'common')
 * @returns Number of files successfully converted
 */
export function convertChromeForMod(modDir: string, modId: string): number {
  let total = 0
  const srcBase = path.join(OPENRA_MODS_DIR, modDir)

  // 1. chrome/ directory
  const chromeDir = path.join(srcBase, 'chrome')
  if (fs.existsSync(chromeDir)) {
    total += convertChromeDirectory(chromeDir, modId)
  }

  // 2. Top-level chrome.yaml
  const chromeYaml = path.join(srcBase, 'chrome.yaml')
  if (fs.existsSync(chromeYaml)) {
    if (convertTopLevelChromeYaml(chromeYaml, modId)) {
      total++
    }
  }

  return total
}

// ---------------------------------------------------------------------------
// Chrome directory conversion
// ---------------------------------------------------------------------------

/**
 * Convert all *.yaml files in a chrome/ directory to JSON.
 *
 * Each YAML file represents a widget layout tree (e.g., mainmenu.yaml,
 * ingame.yaml, settings.yaml). The output is written to
 * `public/mods/{modId}/chrome/{name}.json`.
 *
 * Inheritance resolution is enabled because some chrome YAML files use
 * `^` overlay definitions (e.g., ^Sidebar, ^Dialog).
 *
 * @param srcDir — Absolute path to source chrome/ directory
 * @param modId  — Target mod ID for output (e.g., 'ra', 'common')
 * @returns Number of files successfully converted
 */
function convertChromeDirectory(srcDir: string, modId: string): number {
  const outDir = path.join(PUBLIC_MODS_DIR, modId, 'chrome')
  fs.mkdirSync(outDir, { recursive: true })

  const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.yaml'))
  if (files.length === 0) {
    console.log(`  [chrome/] No YAML files in ${srcDir}`)
    return 0
  }

  let converted = 0

  for (const file of files) {
    const srcPath = path.join(srcDir, file)
    const outFile = file.replace(/\.yaml$/, '.json')
    const outPath = path.join(outDir, outFile)

    try {
      const yamlContent = fs.readFileSync(srcPath, 'utf-8')
      const parser = new MiniYamlParser({ resolveInherits: true })
      const parsed = parser.parse(yamlContent)
      fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2), 'utf-8')
      converted++
    } catch (e) {
      console.warn(
        `  [chrome/] Failed to convert ${file}: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  if (converted > 0) {
    console.log(`  [chrome/] Converted ${converted}/${files.length} files -> ${outDir}`)
  }

  return converted
}

// ---------------------------------------------------------------------------
// Top-level chrome.yaml conversion
// ---------------------------------------------------------------------------

/**
 * Convert a top-level chrome.yaml (chrome definitions like button styles,
 * panel regions, dialog borders) to chrome.json.
 *
 * This is the `Chrome:` section of mod.yaml (e.g., `ra|chrome.yaml`).
 * The output is written to `public/mods/{modId}/chrome.json`.
 *
 * Inheritance resolution is ALWAYS enabled for chrome.yaml because it
 * heavily uses the `Inherits: ^Template` pattern for shared chrome styles.
 *
 * @param srcPath — Absolute path to the chrome.yaml file
 * @param modId   — Target mod ID for output directory
 * @returns true if conversion succeeded, false otherwise
 */
function convertTopLevelChromeYaml(srcPath: string, modId: string): boolean {
  const outDir = path.join(PUBLIC_MODS_DIR, modId)
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, 'chrome.json')

  try {
    const yamlContent = fs.readFileSync(srcPath, 'utf-8')
    const parser = new MiniYamlParser({ resolveInherits: true })
    const parsed = parser.parse(yamlContent)
    fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2), 'utf-8')
    console.log(`  [chrome.yaml] Wrote -> ${outPath}`)
    return true
  } catch (e) {
    console.warn(
      `  [chrome.yaml] Failed: ${e instanceof Error ? e.message : String(e)}`,
    )
    return false
  }
}

// ---------------------------------------------------------------------------
// Entry point (only runs when executed directly, not when imported)
// ---------------------------------------------------------------------------

/**
 * Detect if this script is the main entry point (directly executed via tsx)
 * vs. being imported as a module by build-mods.ts.
 *
 * Uses process.argv[1] comparison: when tsx runs a script, argv[1] is the
 * script path. We compare it against import.meta.url (file:// URL).
 */
function isMainModule(): boolean {
  const entryPoint = process.argv[1]
  if (!entryPoint) return false

  // Normalize Windows backslashes to forward slashes
  const normalizedEntry = entryPoint.replace(/\\/g, '/')

  // import.meta.url is file:///path/to/script.ts
  const urlPath = import.meta.url.replace(/^file:\/\/\//, '').replace(/^file:\/\//, '')

  return urlPath.endsWith(normalizedEntry) || normalizedEntry.endsWith(urlPath)
}

if (isMainModule()) {
  main().catch((e) => {
    console.error('[build-chrome] Fatal error:', e)
    process.exit(1)
  })
}
