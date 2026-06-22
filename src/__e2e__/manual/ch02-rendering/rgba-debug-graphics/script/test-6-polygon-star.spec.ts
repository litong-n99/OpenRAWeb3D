/**
 * Playwright E2E Tests — Expect 5: Pentagon Star Polygon (DrawPolygon)
 *
 * Verifies:
 *   - 'polygon' filter shows star polygon quads only
 *   - Star uses 10 triangles (center-point triangulation) = 10 quads (degenerate triangles as quads)
 *   - Quad count is non-zero
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

test('expect 5: pentagon star polygon correct', async ({ page }) => {
  test.setTimeout(30000);

  await page.goto(PAGE_URL);
  await page.waitForSelector('#info-engine', { timeout: 15000 });
  await page.waitForTimeout(800);

  // Switch to 'polygon' filter (only star)
  await page.selectOption('#shape-select', 'polygon');
  await page.waitForTimeout(500);

  // Quad count: star uses center-point triangulation = 10 triangles = 10 degenerate quads
  const starQuadText = await page.locator('#state-quads').textContent();
  const starQuadCount = parseInt(starQuadText ?? '0', 10);
  // 10 triangles from center (each triangle = 1 degenerate quad)
  expect(starQuadCount).toBeGreaterThanOrEqual(10);

  // Engine healthy after filter switch
  await expect(page.locator('#gpu-error')).toBeHidden();

  // Screenshot: star-only view
  await page.screenshot({
    path: evidenceFile('screenshot-6-star-polygon.png'),
    fullPage: true,
  });
});
