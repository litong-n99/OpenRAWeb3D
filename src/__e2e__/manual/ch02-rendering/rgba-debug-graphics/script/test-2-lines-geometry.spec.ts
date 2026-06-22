/**
 * Playwright E2E Tests — Expect 1: Lines Geometry (DrawLine)
 *
 * Verifies:
 *   - When filtering to 'lines', only line-related quads are rendered
 *   - Quad count reduces appropriately (lines are fewer quads than 'all')
 *   - Line color (red #e94560) is reflected in the line-color input
 *   - Canvas renders without errors after filter change
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

test('expect 1: lines geometry renders correctly', async ({ page }) => {
  test.setTimeout(30000);

  await page.goto(PAGE_URL);
  await page.waitForSelector('#info-engine', { timeout: 15000 });
  await page.waitForTimeout(800);

  // Record baseline quad count with 'all' filter
  const allQuadText = await page.locator('#state-quads').textContent();
  const allQuadCount = parseInt(allQuadText ?? '0', 10);
  expect(allQuadCount).toBeGreaterThan(0);

  // Switch to 'lines' filter
  await page.selectOption('#shape-select', 'lines');
  await page.waitForTimeout(500);

  // Quad count should change (fewer quads in 'lines' mode)
  const linesQuadText = await page.locator('#state-quads').textContent();
  const linesQuadCount = parseInt(linesQuadText ?? '0', 10);
  expect(linesQuadCount).toBeGreaterThan(0);
  expect(linesQuadCount).toBeLessThan(allQuadCount);

  // Verify line color is set to default red (#e94560)
  const lineColor = await page.locator('#line-color').inputValue();
  expect(lineColor.toLowerCase()).toBe('#e94560');

  // Engine should still be healthy after filter change
  await expect(page.locator('#gpu-error')).toBeHidden();

  // Screenshot: lines-only view
  await page.screenshot({
    path: evidenceFile('screenshot-2-lines-filter.png'),
    fullPage: true,
  });

  // Restore to 'all' and verify quad count returns
  await page.selectOption('#shape-select', 'all');
  await page.waitForTimeout(500);
  const restoredQuadText = await page.locator('#state-quads').textContent();
  const restoredQuadCount = parseInt(restoredQuadText ?? '0', 10);
  expect(restoredQuadCount).toBe(allQuadCount);
});
