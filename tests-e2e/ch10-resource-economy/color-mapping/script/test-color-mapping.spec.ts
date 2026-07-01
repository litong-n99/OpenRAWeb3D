/**
 * test-color-mapping.spec.ts
 *
 * Acceptance tests for ch10-resource-economy/color-mapping
 * Validates resource type color mapping, variant distinguishability,
 * density gradient monotonicity, layout switching, and legend precision.
 *
 * Test page: http://localhost:5173/test/ch10-resource-economy/color-mapping/
 */

import { test, expect } from '@playwright/test';

const PAGE_URL = '/test/ch10-resource-economy/color-mapping/';

interface LegendEntry {
  density: number;
  variant: number;
  hex: string;
}

interface ResourceTypeMeta {
  rowsId: string;
  name: string;
  expectedVariants: number;
}

const RESOURCE_TYPES: ResourceTypeMeta[] = [
  { rowsId: 'legend-tib-rows', name: 'Tiberium', expectedVariants: 4 },
  { rowsId: 'legend-ore-rows', name: 'Ore', expectedVariants: 4 },
  { rowsId: 'legend-spice-rows', name: 'Spice', expectedVariants: 3 },
  { rowsId: 'legend-gems-rows', name: 'Gems', expectedVariants: 4 },
];

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function luminance(rgb: { r: number; g: number; b: number }): number {
  return 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
}

async function getLegendEntries(page: any, rowsId: string): Promise<LegendEntry[]> {
  return page.$$eval(`#${rowsId} .legend-row`, (rows: HTMLElement[]) =>
    rows
      .map((row) => {
        const text = row.textContent || '';
        const match = text.match(/D(\d+)\s+V(\d+)\s+(#[0-9a-fA-F]{6})/);
        if (!match) return null;
        return {
          density: parseInt(match[1], 10),
          variant: parseInt(match[2], 10),
          hex: match[3].toLowerCase(),
        };
      })
      .filter((item): item is LegendEntry => item !== null)
  );
}

async function getEntryByDensityVariant(
  page: any,
  rowsId: string,
  density: number,
  variant: number,
): Promise<LegendEntry | undefined> {
  const entries = await getLegendEntries(page, rowsId);
  return entries.find((e) => e.density === density && e.variant === variant);
}

test.describe('Resource Color Mapping Acceptance Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'networkidle' });

    // Wait for Babylon.js scene to initialize.
    await page.waitForFunction(
      () => {
        const el = document.getElementById('info-engine');
        const text = el?.textContent || '';
        return text.includes('Babylon.js') && text.includes('WebGL 2.0');
      },
      { timeout: 15000 },
    );

    // Allow initial render + legend population.
    await page.waitForTimeout(500);

    (page as any).__pageErrors = [];
    page.on('pageerror', (err: Error) => {
      ((page as any).__pageErrors as string[]).push(err.message);
    });
  });

  test.afterEach(async ({ page }) => {
    const errors = ((page as any).__pageErrors as string[]) || [];
    expect(errors, `Unexpected page errors: ${errors.join(', ')}`).toHaveLength(0);
  });

  // ===========================================================================
  // E1: Resource Type Color Mapping
  // ===========================================================================
  test('E1: Resource type color mapping is correct', async ({ page }) => {
    const engineText = await page.locator('#info-engine').textContent();
    expect(engineText).toContain('Babylon.js');
    expect(engineText).toContain('WebGL 2.0');

    const gpuError = page.locator('#gpu-error');
    await expect(gpuError).not.toBeVisible();

    for (const rt of RESOURCE_TYPES) {
      const rows = page.locator(`#${rt.rowsId}`);
      await expect(rows, `${rt.name} legend rows should exist`).toBeVisible();
    }

    const tibD10V0 = await getEntryByDensityVariant(page, 'legend-tib-rows', 10, 0);
    const oreD10V0 = await getEntryByDensityVariant(page, 'legend-ore-rows', 10, 0);
    const spiceD10V0 = await getEntryByDensityVariant(page, 'legend-spice-rows', 10, 0);
    const gemsD10V0 = await getEntryByDensityVariant(page, 'legend-gems-rows', 10, 0);

    expect(tibD10V0, 'Tiberium D10 V0 entry should exist').toBeDefined();
    expect(oreD10V0, 'Ore D10 V0 entry should exist').toBeDefined();
    expect(spiceD10V0, 'Spice D10 V0 entry should exist').toBeDefined();
    expect(gemsD10V0, 'Gems D10 V0 entry should exist').toBeDefined();

    const tibRgb = hexToRgb(tibD10V0!.hex);
    const oreRgb = hexToRgb(oreD10V0!.hex);
    const spiceRgb = hexToRgb(spiceD10V0!.hex);
    const gemsRgb = hexToRgb(gemsD10V0!.hex);

    // Tiberium: green-ish (G > R and G > B)
    expect(tibRgb.g, 'Tiberium D10 V0 G should exceed R').toBeGreaterThan(tibRgb.r);
    expect(tibRgb.g, 'Tiberium D10 V0 G should exceed B').toBeGreaterThan(tibRgb.b);

    // Ore: gold-ish (R > B and G > B)
    expect(oreRgb.r, 'Ore D10 V0 R should exceed B').toBeGreaterThan(oreRgb.b);
    expect(oreRgb.g, 'Ore D10 V0 G should exceed B').toBeGreaterThan(oreRgb.b);

    // Spice: orange-red (R > G and R > B)
    expect(spiceRgb.r, 'Spice D10 V0 R should exceed G').toBeGreaterThan(spiceRgb.g);
    expect(spiceRgb.r, 'Spice D10 V0 R should exceed B').toBeGreaterThan(spiceRgb.b);

    // Gems: purple (R > G and B > G)
    expect(gemsRgb.r, 'Gems D10 V0 R should exceed G').toBeGreaterThan(gemsRgb.g);
    expect(gemsRgb.b, 'Gems D10 V0 B should exceed G').toBeGreaterThan(gemsRgb.g);

    console.log('E1 PASS: Resource type color mapping verified');
  });

  // ===========================================================================
  // E2: Variant Distinguishability
  // ===========================================================================
  test('E2: Variant distinguishability and compare-palettes toggle', async ({ page }) => {
    for (const rt of RESOURCE_TYPES) {
      const entries = await getLegendEntries(page, rt.rowsId);
      const d10Entries = entries.filter((e) => e.density === 10);
      const uniqueHex = new Set(d10Entries.map((e) => e.hex)).size;
      const threshold = rt.expectedVariants >= 4 ? 3 : rt.expectedVariants - 1;
      expect(
        uniqueHex,
        `${rt.name} D10 entries should have at least ${threshold} distinct hex values (got ${uniqueHex})`,
      ).toBeGreaterThanOrEqual(threshold);
    }

    const btn = page.locator('#btn-compare-palettes');
    await expect(btn).toHaveText('比较调色板 (原色 vs 偏移)');

    await btn.click();
    await page.waitForTimeout(300);

    await expect(btn).toHaveText('显示原始颜色');
    const activeBg = await page.$eval('#btn-compare-palettes', (el: HTMLElement) =>
      window.getComputedStyle(el).backgroundColor,
    );
    expect(activeBg).toContain('233, 69, 96'); // #e94560

    await btn.click();
    await page.waitForTimeout(300);

    await expect(btn).toHaveText('比较调色板 (原色 vs 偏移)');

    console.log('E2 PASS: Variant distinguishability and compare toggle verified');
  });

  // ===========================================================================
  // E3: Density Gradient Monotonic
  // ===========================================================================
  test('E3: Density gradient luminance is strictly increasing', async ({ page }) => {
    for (const rt of RESOURCE_TYPES) {
      const samples = [1, 4, 7, 10].map((density) => ({
        density,
        entry: null as LegendEntry | undefined,
      }));

      for (const s of samples) {
        s.entry = await getEntryByDensityVariant(page, rt.rowsId, s.density, 0);
        expect(s.entry, `${rt.name} D${s.density} V0 entry should exist`).toBeDefined();
      }

      const lums = samples.map((s) => luminance(hexToRgb(s.entry!.hex)));
      for (let i = 1; i < lums.length; i++) {
        expect(
          lums[i],
          `${rt.name} luminance should increase from D${samples[i - 1].density} to D${samples[i].density}`,
        ).toBeGreaterThan(lums[i - 1]);
      }
      expect(
        lums[lums.length - 1],
        `${rt.name} D10 luminance should exceed D1 luminance`,
      ).toBeGreaterThan(lums[0]);
    }

    console.log('E3 PASS: Density gradient monotonicity verified');
  });

  // ===========================================================================
  // E4: Layout Switching
  // ===========================================================================
  test('E4: Layout mode switching completes without error', async ({ page }) => {
    const layoutSel = page.locator('#layout-mode');

    await layoutSel.selectOption('side-by-side');
    await page.waitForTimeout(400);
    await expect(layoutSel).toHaveValue('side-by-side');

    await layoutSel.selectOption('density-wheels');
    await page.waitForTimeout(400);
    await expect(layoutSel).toHaveValue('density-wheels');

    await layoutSel.selectOption('grid');
    await page.waitForTimeout(400);
    await expect(layoutSel).toHaveValue('grid');

    console.log('E4 PASS: Layout switching verified');
  });

  // ===========================================================================
  // E5: Legend Hex Precision
  // ===========================================================================
  test('E5: Legend hex precision and max-density update', async ({ page }) => {
    // All entries must be #RRGGBB.
    for (const rt of RESOURCE_TYPES) {
      const entries = await getLegendEntries(page, rt.rowsId);
      expect(entries.length, `${rt.name} legend should have entries`).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.hex, `${rt.name} hex format`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }

    // Default density=10 should expose D1, D4, D7, D10.
    for (const rt of RESOURCE_TYPES) {
      const entries = await getLegendEntries(page, rt.rowsId);
      const densities = [...new Set(entries.map((e) => e.density))].sort((a, b) => a - b);
      expect(densities, `${rt.name} default density sample points`).toEqual([1, 4, 7, 10]);
    }

    const d10V0Before: Record<string, string> = {};
    for (const rt of RESOURCE_TYPES) {
      const entry = await getEntryByDensityVariant(page, rt.rowsId, 10, 0);
      expect(entry, `${rt.name} D10 V0 before density change`).toBeDefined();
      d10V0Before[rt.name] = entry!.hex;
    }

    const d1V0Before: Record<string, string> = {};
    for (const rt of RESOURCE_TYPES) {
      const entry = await getEntryByDensityVariant(page, rt.rowsId, 1, 0);
      expect(entry, `${rt.name} D1 V0 before density change`).toBeDefined();
      d1V0Before[rt.name] = entry!.hex;
    }

    // Switch to max-density 12.
    await page.locator('#max-density').selectOption('12');
    await page.waitForTimeout(400);
    await expect(page.locator('#max-density')).toHaveValue('12');

    // Legend should now contain D12 instead of D10.
    for (const rt of RESOURCE_TYPES) {
      const entries = await getLegendEntries(page, rt.rowsId);
      const densities = [...new Set(entries.map((e) => e.density))].sort((a, b) => a - b);
      expect(densities, `${rt.name} density=12 sample points`).toEqual([1, 4, 8, 12]);
      expect(
        entries.some((e) => e.density === 12),
        `${rt.name} should have D12 entries`,
      ).toBe(true);
      expect(
        entries.some((e) => e.density === 10),
        `${rt.name} should no longer have D10 entries`,
      ).toBe(false);
    }

    // D12 V0 should equal D10 V0 because the same maxColor endpoint is used.
    // D1 V0 should also remain identical.
    for (const rt of RESOURCE_TYPES) {
      const d12v0 = await getEntryByDensityVariant(page, rt.rowsId, 12, 0);
      const d1v0 = await getEntryByDensityVariant(page, rt.rowsId, 1, 0);
      expect(d12v0, `${rt.name} D12 V0 after density change`).toBeDefined();
      expect(d1v0, `${rt.name} D1 V0 after density change`).toBeDefined();
      expect(d12v0!.hex, `${rt.name} D12 V0 should match prior D10 V0`).toBe(d10V0Before[rt.name]);
      expect(d1v0!.hex, `${rt.name} D1 V0 should remain unchanged`).toBe(d1V0Before[rt.name]);
    }

    // Restore default density=10.
    await page.locator('#max-density').selectOption('10');
    await page.waitForTimeout(400);
    await expect(page.locator('#max-density')).toHaveValue('10');

    console.log('E5 PASS: Legend hex precision and max-density update verified');
  });

  // ===========================================================================
  // E6: Max Density Change — Canvas Update / No Crash
  // ===========================================================================
  test('E6: Max density change updates canvas without crash', async ({ page }) => {
    const canvas = page.locator('#sandbox canvas');
    await expect(canvas).toBeVisible();

    const initialSize = await canvas.evaluate((el: HTMLCanvasElement) => ({
      width: el.width,
      height: el.height,
    }));
    expect(initialSize.width, 'Canvas width should be positive').toBeGreaterThan(0);
    expect(initialSize.height, 'Canvas height should be positive').toBeGreaterThan(0);

    // Toggle max density and confirm the scene still renders.
    await page.locator('#max-density').selectOption('12');
    await page.waitForTimeout(500);
    await expect(page.locator('#max-density')).toHaveValue('12');

    await page.locator('#max-density').selectOption('10');
    await page.waitForTimeout(500);
    await expect(page.locator('#max-density')).toHaveValue('10');

    await page.screenshot({
      path: 'test-results/manual/ch10-resource-economy/color-mapping/evidence/screenshot-e6-density-change.png',
      fullPage: false,
    });

    console.log('E6 PASS: Max density change handled without crash');
  });
});
