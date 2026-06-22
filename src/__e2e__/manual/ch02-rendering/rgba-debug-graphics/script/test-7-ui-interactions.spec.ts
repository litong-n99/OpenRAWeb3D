/**
 * Playwright E2E Tests — UI Interactions
 *
 * Verifies:
 *   - Shape filter dropdown cycles through all options without errors
 *   - Line width slider changes display value and triggers rebuild
 *   - Color pickers + apply-colors button work
 *   - All 5 filter options produce valid quad counts
 */

import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const PAGE_URL = 'http://localhost:5173/test/ch02-rendering/rgba-debug-graphics/';
const EVIDENCE_DIR = path.resolve(
  'test-results/manual/ch02-rendering/rgba-debug-graphics/evidence'
);

function evidenceFile(name: string): string {
  return path.join(EVIDENCE_DIR, name);
}

if (!fs.existsSync(EVIDENCE_DIR)) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

test('shape filter dropdown cycles all options without errors', async ({ page }) => {
  test.setTimeout(30000);

  await page.goto(PAGE_URL);
  await page.waitForSelector('#info-engine', { timeout: 15000 });
  await page.waitForTimeout(800);

  const filters = ['all', 'lines', 'rect', 'fillrect', 'ellipse', 'polygon'];

  for (const filter of filters) {
    await page.selectOption('#shape-select', filter);
    await page.waitForTimeout(400);

    // Verify no GPU error for any filter
    const errorVisible = await page.locator('#gpu-error').isVisible();
    expect(errorVisible, `GPU error should not be visible for filter "${filter}"`).toBe(false);

    // Verify quad count is displayed (not empty/hyphen)
    const quadText = await page.locator('#state-quads').textContent();
    expect(quadText, `Quad count should be populated for filter "${filter}"`).not.toBe('-');
    expect(quadText?.length ?? 0).toBeGreaterThan(0);

    // Verify info bar still healthy
    const engineInfo = await page.locator('#info-engine').textContent();
    expect(engineInfo).toMatch(/Babylon\.js/);
  }
});

test('line width slider changes value and rebuilds', async ({ page }) => {
  test.setTimeout(30000);

  await page.goto(PAGE_URL);
  await page.waitForSelector('#info-engine', { timeout: 15000 });
  await page.waitForTimeout(800);

  // Test various width values
  const widths = [1, 2, 4, 6, 8];
  for (const w of widths) {
    await page.fill('#width-slider', String(w));
    await page.waitForTimeout(400);

    // Display value should match
    const widthVal = await page.locator('#width-val').textContent();
    // Use toFixed(1) comparison since slider step is 0.5
    const displayW = parseFloat(widthVal ?? '0');
    expect(Math.abs(displayW - w)).toBeLessThan(0.1);

    // No GPU error after resize
    await expect(page.locator('#gpu-error')).toBeHidden();
  }
});

test('color pickers and apply button work', async ({ page }) => {
  test.setTimeout(30000);

  await page.goto(PAGE_URL);
  await page.waitForSelector('#info-engine', { timeout: 15000 });
  await page.waitForTimeout(800);

  // Change both colors
  await page.fill('#line-color', '#ff0000');
  await page.fill('#fill-color', '#0000ff');
  await page.locator('#apply-colors').click();
  await page.waitForTimeout(500);

  // Verify inputs retained values
  expect(await page.locator('#line-color').inputValue()).toMatch(/#ff0000/i);
  expect(await page.locator('#fill-color').inputValue()).toMatch(/#0000ff/i);

  // No GPU error
  await expect(page.locator('#gpu-error')).toBeHidden();

  // Quad count still populated
  const quadText = await page.locator('#state-quads').textContent();
  expect(parseInt(quadText ?? '0', 10)).toBeGreaterThan(0);

  // Screenshot with custom colors
  await page.screenshot({
    path: evidenceFile('screenshot-7-custom-colors.png'),
    fullPage: true,
  });

  // Restore defaults and verify
  await page.fill('#line-color', '#e94560');
  await page.fill('#fill-color', '#2ecc71');
  await page.locator('#apply-colors').click();
  await page.waitForTimeout(500);
  await expect(page.locator('#gpu-error')).toBeHidden();
});

test('info bar displays all required fields', async ({ page }) => {
  test.setTimeout(30000);

  await page.goto(PAGE_URL);
  await page.waitForSelector('#info-engine', { timeout: 15000 });
  await page.waitForTimeout(800);

  // All info fields populated
  const fields = ['#info-ua', '#info-viewport', '#info-engine', '#info-fps', '#info-time'];
  for (const selector of fields) {
    const text = await page.locator(selector).textContent();
    expect(text?.length ?? 0, `${selector} should have content`).toBeGreaterThan(0);
    expect(text, `${selector} should not be "-"`).not.toBe('-');
  }
});

test('quad count changes between filter modes', async ({ page }) => {
  test.setTimeout(30000);

  await page.goto(PAGE_URL);
  await page.waitForSelector('#info-engine', { timeout: 15000 });
  await page.waitForTimeout(800);

  // Collect quad counts for each mode
  const modes = ['all', 'lines', 'rect', 'fillrect', 'ellipse', 'polygon'];
  const counts: Record<string, number> = {};

  for (const mode of modes) {
    await page.selectOption('#shape-select', mode);
    await page.waitForTimeout(400);
    const quadText = await page.locator('#state-quads').textContent();
    counts[mode] = parseInt(quadText ?? '0', 10);
    expect(counts[mode]).toBeGreaterThan(0);
  }

  // 'all' should have the most quads (sum of all individual modes)
  const sumIndividual = counts.lines + counts.rect + counts.fillrect + counts.ellipse + counts.polygon;
  expect(counts.all).toBeGreaterThanOrEqual(sumIndividual);

  // Individual modes should have different quad counts
  const uniqueCounts = new Set(Object.values(counts));
  expect(uniqueCounts.size).toBeGreaterThan(1);
});
