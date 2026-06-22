/**
 * TerrainInfo / TileSet Acceptance Test
 *
 * URL: http://localhost:5173/test/ch04-map-terrain/terrain-types/
 *
 * Validates terrain type ARGB colors, TileSet template/tile registration,
 * getColor() interpolation behavior, and basic rendering performance.
 *
 * Headless caveats:
 *   * FPS readouts are approximate in headless Chromium/SwiftShader.
 *   * 3D plane colors are verified through material emissiveColor (source of
 *     truth) rather than canvas pixel reads to avoid GPU compositing variance.
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const PAGE_URL = '/test/ch04-map-terrain/terrain-types/';
const EVIDENCE_DIR = path.resolve(
  process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results',
  'manual/ch04-map-terrain/terrain-types/evidence'
);

function evidencePath(name: string): string {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
  return path.join(EVIDENCE_DIR, name);
}

interface TerrainColorExpectation {
  type: string;
  hex: string;
  r: number;
  g: number;
  b: number;
  a: number;
}

const TERRAIN_COLORS: TerrainColorExpectation[] = [
  { type: 'Clear', hex: '#90EE90', r: 144, g: 238, b: 144, a: 255 },
  { type: 'Rough', hex: '#D2B48C', r: 210, g: 180, b: 140, a: 255 },
  { type: 'Road', hex: '#708090', r: 112, g: 128, b: 144, a: 255 },
  { type: 'Water', hex: '#4169E1', r: 65, g: 105, b: 225, a: 255 },
  { type: 'Rock', hex: '#808080', r: 128, g: 128, b: 128, a: 255 },
  { type: 'Wall', hex: '#A0522D', r: 160, g: 82, b: 45, a: 255 },
  { type: 'Tiberium', hex: '#00FF7F', r: 0, g: 255, b: 127, a: 255 },
  { type: 'Beach', hex: '#F5DEB3', r: 245, g: 222, b: 179, a: 255 },
  { type: 'River', hex: '#1E90FF', r: 30, g: 144, b: 255, a: 255 },
  { type: 'Cliff', hex: '#A9A9A9', r: 169, g: 169, b: 169, a: 255 },
];

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function waitForPageReady(page: Page, timeout = 20000): Promise<void> {
  await page.goto(PAGE_URL);

  // Wait for the dynamically created canvas.
  await page.waitForSelector('#sandbox canvas', { timeout });

  // Wait for terrain list to be populated.
  await page.waitForSelector('#terrain-list .terrain-item', { timeout });

  // Wait for template tiles to be populated.
  await page.waitForSelector('#template-tiles .tile-item', { timeout });

  // Wait for stats to be populated (numeric values, not placeholder '-').
  await page.waitForFunction(
    () => {
      const types = document.getElementById('stat-types')?.textContent ?? '';
      const templates = document.getElementById('stat-templates')?.textContent ?? '';
      const tiles = document.getElementById('stat-tiles')?.textContent ?? '';
      return /^\d+$/.test(types) && /^\d+$/.test(templates) && /^\d+$/.test(tiles);
    },
    { timeout }
  );

  // Wait for WebGL engine info.
  await page.waitForFunction(
    () => {
      const el = document.getElementById('info-engine');
      return el !== null && el.textContent !== null && el.textContent.includes('WebGL');
    },
    { timeout }
  );

  // Allow the first render frames to complete and FPS counter to update.
  await page.waitForTimeout(800);
}

async function getTerrainItems(page: Page): Promise<{ name: string; hex: string }[]> {
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('#terrain-list .terrain-item'));
    return items.map((item) => {
      const name = item.querySelector('.terrain-name')?.textContent?.trim() ?? '';
      const hex = item.querySelector('.terrain-hex')?.textContent?.trim() ?? '';
      return { name, hex };
    });
  });
}

async function getTileItemByLabel(page: Page, label: string): Promise<{
  text: string;
  hex: string;
  badges: string[];
} | null> {
  return page.evaluate((labelText) => {
    const items = Array.from(document.querySelectorAll('#template-tiles .tile-item'));
    const item = items.find((el) => {
      const span = el.querySelector('span');
      return span?.textContent?.trim() === labelText;
    });
    if (!item) return null;

    const text = item.querySelector('span')?.textContent?.trim() ?? '';
    const hex =
      Array.from(item.querySelectorAll('span'))
        .find((s) => s.textContent?.startsWith('#'))
        ?.textContent?.trim() ?? '';
    const badges = Array.from(item.querySelectorAll('.badge'))
      .map((b) => b.textContent?.trim() ?? '')
      .filter(Boolean);
    return { text, hex, badges };
  }, label);
}

async function getCurrentFps(page: Page): Promise<number> {
  const text = await page.locator('#info-fps').textContent();
  return parseFloat((text ?? '0').trim());
}

async function isHeadlessEnvironment(page: Page): Promise<boolean> {
  return page.evaluate(() => navigator.userAgent.toLowerCase().includes('headless'));
}

async function randomizeColors(page: Page, times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.click('#randomize-colors');
    await page.waitForTimeout(80);
  }
}

// -----------------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------------

test.describe('TerrainInfo / TileSet — terrain type classification and color verification', () => {
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    await waitForPageReady(page);
  });

  // ===========================================================================
  // 1. Terrain type colors
  // ===========================================================================

  test('1.1 - Terrain type swatches display correct hex colors', async ({ page }) => {
    const items = await getTerrainItems(page);
    expect(items).toHaveLength(TERRAIN_COLORS.length);

    for (const expected of TERRAIN_COLORS) {
      const actual = items.find((i) => i.name === expected.type);
      expect(actual, `terrain type ${expected.type} should be listed`).toBeDefined();
      expect(actual!.hex.toUpperCase()).toBe(expected.hex.toUpperCase());
    }

    // Also verify parseColorHex precision from the source module.
    const parseResult = await page.evaluate(async () => {
      const mod = await import('/src/OpenRA.Game/Map/TerrainInfo.ts');
      return mod.parseColorHex('#90EE90');
    });
    expect(parseResult).toBe(0xff90ee90 >>> 0);

    await page.screenshot({ path: evidencePath('terrain-types-1-1-side-panel.png'), fullPage: false });
  });

  test('1.2 - 3D plane emissive colors match terrain type definitions', async ({ page }) => {
    const meshColors = await page.evaluate((expectedTypes) => {
      const scene = (window as any).__scene;
      if (!scene) throw new Error('Babylon scene not found');

      const result: Record<string, { r: number; g: number; b: number; a: number }> = {};
      for (const type of expectedTypes) {
        const mesh = scene.getMeshByName(`terrain-${type}`);
        const mat = mesh?.material as any;
        const color = mat?.emissiveColor;
        const alpha = mat?.alpha ?? 1;
        if (!color) {
          throw new Error(`Missing emissiveColor for terrain-${type}`);
        }
        result[type] = {
          r: Math.round(color.r * 255),
          g: Math.round(color.g * 255),
          b: Math.round(color.b * 255),
          a: Math.round(alpha * 255),
        };
      }
      return result;
    }, TERRAIN_COLORS.map((c) => c.type));

    for (const expected of TERRAIN_COLORS) {
      const actual = meshColors[expected.type];
      expect(actual, `mesh terrain-${expected.type} should exist`).toBeDefined();
      expect(actual.r).toBe(expected.r);
      expect(actual.g).toBe(expected.g);
      expect(actual.b).toBe(expected.b);
      expect(actual.a).toBe(expected.a);
    }

    await page.screenshot({ path: evidencePath('terrain-types-1-2-3d-planes.png'), fullPage: false });
  });

  // ===========================================================================
  // 2. TileSet loading and details
  // ===========================================================================

  test('2.1 - TileSet statistics display correct counts', async ({ page }) => {
    const types = await page.locator('#stat-types').textContent();
    const templates = await page.locator('#stat-templates').textContent();
    const tiles = await page.locator('#stat-tiles').textContent();
    const ramped = await page.locator('#stat-ramped').textContent();

    expect(parseInt((types ?? '').trim(), 10)).toBe(10);
    expect(parseInt((templates ?? '').trim(), 10)).toBe(8);
    expect(parseInt((tiles ?? '').trim(), 10)).toBe(8);
    expect(parseInt((ramped ?? '').trim(), 10)).toBe(1); // only Tpl#5[0] has rampType=5

    // Verify TileSet.getTileInfo through the exposed globals.
    const tileInfo = await page.evaluate(() => {
      const TileSet = (window as any).TileSet;
      const TerrainTile = (window as any).TerrainTile;
      const info = TileSet.getTileInfo(new TerrainTile(0, 0));
      const clearIndex = TileSet.getTerrainIndex('Clear');
      return {
        terrainTypeIndex: info.terrainType,
        clearIndex,
      };
    });
    expect(tileInfo).toBeDefined();
    expect(tileInfo.terrainTypeIndex).toBe(tileInfo.clearIndex);
  });

  test('2.2 - Template tile details show correct height/ramp/riser', async ({ page }) => {
    const tpl5 = await getTileItemByLabel(page, 'Tpl#5[0]');
    expect(tpl5).not.toBeNull();
    expect(tpl5!.badges).toContain('h=2');
    expect(tpl5!.badges).toContain('ramp=5');

    const tpl10 = await getTileItemByLabel(page, 'Tpl#10[0]');
    expect(tpl10).not.toBeNull();
    expect(tpl10!.badges).toContain('riser');

    const tpl0 = await getTileItemByLabel(page, 'Tpl#0[0]');
    expect(tpl0).not.toBeNull();
    expect(tpl0!.text).toBe('Tpl#0[0]');

    await page.screenshot({ path: evidencePath('terrain-types-2-2-template-tiles.png'), fullPage: false });
  });

  // ===========================================================================
  // 3. getColor interpolation
  // ===========================================================================

  test('3.1 - getColor interpolation changes color for tiles with min/max range', async ({ page }) => {
    const before = await getTileItemByLabel(page, 'Tpl#0[0]');
    expect(before).not.toBeNull();
    const initialHex = before!.hex;

    await randomizeColors(page, 5);

    const after = await getTileItemByLabel(page, 'Tpl#0[0]');
    expect(after).not.toBeNull();
    expect(after!.hex).not.toBe(initialHex);

    // Verify colorLerp(0.5, min, max) is the arithmetic mean for Clear.
    const lerpResult = await page.evaluate(async () => {
      const mod = await import('/src/OpenRA.Game/Map/TerrainInfo.ts');
      const min = mod.parseColorHex('#88E088');
      const max = mod.parseColorHex('#98F898');
      return mod.colorLerp(0.5, min, max);
    });
    expect(lerpResult).toBe(0xff90ec90 >>> 0);

    await page.screenshot({ path: evidencePath('terrain-types-3-1-randomized-clear.png'), fullPage: false });
  });

  test('3.2 - getColor produces constant color when min == max', async ({ page }) => {
    const before = await getTileItemByLabel(page, 'Tpl#3[0]');
    expect(before).not.toBeNull();
    const initialHex = before!.hex;
    expect(initialHex.toUpperCase()).toBe('#708090');

    await randomizeColors(page, 5);

    const after = await getTileItemByLabel(page, 'Tpl#3[0]');
    expect(after).not.toBeNull();
    expect(after!.hex).toBe(initialHex);

    await page.screenshot({ path: evidencePath('terrain-types-3-2-road-constant.png'), fullPage: false });
  });

  // ===========================================================================
  // 4. Rendering performance
  // ===========================================================================

  test('4.1 - FPS counter is active and scene has 11 meshes', async ({ page }) => {
    await page.waitForTimeout(1500);

    const fps = await getCurrentFps(page);
    const headless = await isHeadlessEnvironment(page);

    test.info().annotations.push({
      type: 'fps-note',
      description: `FPS=${fps.toFixed(1)}, headless=${headless}`,
    });

    // In headless mode FPS can be capped/low; just ensure the counter is updating.
    expect(fps).toBeGreaterThan(0);

    const meshCount = await page.evaluate(() => {
      const scene = (window as any).__scene;
      return scene?.meshes.length ?? 0;
    });
    expect(meshCount).toBe(11); // 10 terrain planes + 1 ground plane

    await page.screenshot({ path: evidencePath('terrain-types-4-1-fps.png'), fullPage: false });
  });
});
