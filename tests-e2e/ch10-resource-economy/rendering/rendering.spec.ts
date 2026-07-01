/**
 * rendering.spec.ts
 *
 * Acceptance tests for ch10-resource-economy/rendering.
 * Validates grid alignment, density-driven visuals, variant highlighting,
 * resource type filtering, and density pattern switching.
 *
 * Test page: http://localhost:5173/test/ch10-resource-economy/rendering/
 */

import { test, expect } from '@playwright/test';

const PAGE_URL = '/test/ch10-resource-economy/rendering/';
const SCREENSHOT_DIR = 'test-results/manual/ch10-resource-economy/rendering/evidence';

interface PageStats {
  totalCells: string | null;
  mapSize: string | null;
  avgDensity: string | null;
  activeTypes: string | null;
  variantCount: string | null;
  resourceCells: string | null;
  emptyCells: string | null;
}

async function getStats(page: any): Promise<PageStats> {
  return {
    totalCells: await page.locator('#stat-total-cells').textContent(),
    mapSize: await page.locator('#stat-map-size').textContent().catch(() => null),
    avgDensity: await page.locator('#stat-avg-density').textContent(),
    activeTypes: await page.locator('#stat-active-types').textContent(),
    variantCount: await page.locator('#stat-variant-count').textContent(),
    resourceCells: await page.locator('#stat-resource-cells').textContent(),
    emptyCells: await page.locator('#stat-empty-cells').textContent(),
  };
}

async function waitForBabylonInit(page: any) {
  await page.waitForFunction(
    () => {
      const el = document.getElementById('info-engine');
      const text = el?.textContent || '';
      return text.includes('WebGL 2.0');
    },
    { timeout: 10000 },
  );
}

test.describe('Resource Rendering Acceptance Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'networkidle' });
    await waitForBabylonInit(page);
    await page.waitForTimeout(500);
  });

  // ===========================================================================
  // E1: Grid Alignment and Engine Initialization
  // ===========================================================================
  test('E1: Grid alignment and engine initialization', async ({ page }) => {
    await expect(page.locator('#sandbox canvas')).toBeVisible();

    const engineText = await page.locator('#info-engine').textContent();
    expect(engineText).toContain('WebGL 2.0');

    const stats = await getStats(page);
    expect(stats.totalCells).toBe('216');

    if (stats.mapSize !== null) {
      expect(stats.mapSize).toBe('18x12');
    }

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/screenshot-e1-initial-state.png`,
      fullPage: false,
    });
  });

  // ===========================================================================
  // E2: Density-Driven Visual Changes (Stripes)
  // ===========================================================================
  test('E2: Density-driven visual changes with stripes pattern', async ({ page }) => {
    await page.locator('#density-pattern').selectOption('stripes');
    await page.locator('#btn-regenerate').click();
    await page.waitForTimeout(800);

    const stats = await getStats(page);

    const avgDensity = parseFloat(stats.avgDensity || '0');
    expect(avgDensity).toBeGreaterThan(0);

    expect(stats.activeTypes).toBe('4');
    expect(stats.variantCount).toBe('12');

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/screenshot-e2-stripes-state.png`,
      fullPage: false,
    });
  });

  // ===========================================================================
  // E3: Variant Border Highlighting
  // ===========================================================================
  test('E3: Variant border highlighting with Tiberium-only filter', async ({ page }) => {
    await page.evaluate(() => {
      (document.getElementById('show-ore') as HTMLInputElement).checked = false;
      (document.getElementById('show-spice') as HTMLInputElement).checked = false;
      (document.getElementById('show-gems') as HTMLInputElement).checked = false;
      (document.getElementById('show-tiberium') as HTMLInputElement).checked = true;
      (document.getElementById('btn-apply-filter') as HTMLButtonElement).click();
    });
    await page.waitForTimeout(800);

    const stats = await getStats(page);
    expect(stats.activeTypes).toBe('1');

    const highlightBtn = page.locator('#btn-highlight-variants');
    await highlightBtn.click();
    await page.waitForTimeout(300);

    await expect(highlightBtn).toHaveText('隐藏变体边界');

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/screenshot-e3-variant-borders-tiberium-only.png`,
      fullPage: false,
    });

    // Restore button state so subsequent tests start clean.
    await highlightBtn.click();
    await page.waitForTimeout(300);
  });

  // ===========================================================================
  // E4: Resource Type Filtering
  // ===========================================================================
  test('E4: Resource type filtering cycles Tiberium, Ore, and restores all', async ({ page }) => {
    // Tiberium-only
    await page.evaluate(() => {
      (document.getElementById('show-tiberium') as HTMLInputElement).checked = true;
      (document.getElementById('show-ore') as HTMLInputElement).checked = false;
      (document.getElementById('show-spice') as HTMLInputElement).checked = false;
      (document.getElementById('show-gems') as HTMLInputElement).checked = false;
      (document.getElementById('btn-apply-filter') as HTMLButtonElement).click();
    });
    await page.waitForTimeout(800);

    let stats = await getStats(page);
    expect(stats.activeTypes).toBe('1');

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/screenshot-e4-tiberium-only.png`,
      fullPage: false,
    });

    // Ore-only
    await page.evaluate(() => {
      (document.getElementById('show-tiberium') as HTMLInputElement).checked = false;
      (document.getElementById('show-ore') as HTMLInputElement).checked = true;
      (document.getElementById('show-spice') as HTMLInputElement).checked = false;
      (document.getElementById('show-gems') as HTMLInputElement).checked = false;
      (document.getElementById('btn-apply-filter') as HTMLButtonElement).click();
    });
    await page.waitForTimeout(800);

    stats = await getStats(page);
    expect(stats.activeTypes).toBe('1');

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/screenshot-e4-ore-only.png`,
      fullPage: false,
    });

    // Restore all
    await page.evaluate(() => {
      (document.getElementById('show-tiberium') as HTMLInputElement).checked = true;
      (document.getElementById('show-ore') as HTMLInputElement).checked = true;
      (document.getElementById('show-spice') as HTMLInputElement).checked = true;
      (document.getElementById('show-gems') as HTMLInputElement).checked = true;
      (document.getElementById('btn-apply-filter') as HTMLButtonElement).click();
    });
    await page.waitForTimeout(800);

    stats = await getStats(page);
    expect(stats.activeTypes).toBe('4');
  });

  // ===========================================================================
  // E5: Density Pattern Switching
  // ===========================================================================
  test('E5: Density pattern switching across gradient, hotspot, and stripes', async ({ page }) => {
    // Gradient
    await page.locator('#density-pattern').selectOption('gradient');
    await page.locator('#btn-regenerate').click();
    await page.waitForTimeout(800);

    const gradientStats = await getStats(page);
    const gradientAvg = parseFloat(gradientStats.avgDensity || '0');
    expect(gradientAvg).toBeGreaterThan(0);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/screenshot-e5-gradient-pattern.png`,
      fullPage: false,
    });

    // Hotspot
    await page.locator('#density-pattern').selectOption('hotspot');
    await page.locator('#btn-regenerate').click();
    await page.waitForTimeout(800);

    const hotspotStats = await getStats(page);
    const hotspotAvg = parseFloat(hotspotStats.avgDensity || '0');
    expect(hotspotAvg).toBeGreaterThan(0);
    expect(hotspotAvg).not.toBe(gradientAvg);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/screenshot-e5-hotspot-pattern.png`,
      fullPage: false,
    });

    // Return to default stripes
    await page.locator('#density-pattern').selectOption('stripes');
    await page.locator('#btn-regenerate').click();
    await page.waitForTimeout(800);

    const stripesStats = await getStats(page);
    const stripesAvg = parseFloat(stripesStats.avgDensity || '0');
    expect(stripesAvg).toBeGreaterThan(0);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/screenshot-e5-stripes-default.png`,
      fullPage: false,
    });
  });
});
