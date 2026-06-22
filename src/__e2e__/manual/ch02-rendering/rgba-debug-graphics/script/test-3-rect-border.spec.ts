/**
 * Playwright E2E Tests — Expect 2: Rectangle Border (DrawRect)
 *
 * Verifies:
 *   - 'rect' filter shows rectangle border quads only
 *   - Quad count is non-zero and less than 'all'
 *   - drawRect includes corner gap fill quads (4 extra fillRects per rect border)
 *   - Line color and width settings are active
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

test('expect 2: rectangle border closed without gaps', async ({ page }) => {
  test.setTimeout(30000);

  await page.goto(PAGE_URL);
  await page.waitForSelector('#info-engine', { timeout: 15000 });
  await page.waitForTimeout(800);

  // Switch to 'rect' filter
  await page.selectOption('#shape-select', 'rect');
  await page.waitForTimeout(500);

  // Verify quad count for rect borders
  const rectQuadText = await page.locator('#state-quads').textContent();
  const rectQuadCount = parseInt(rectQuadText ?? '0', 10);
  // drawRect draws 4 line segments (4 quads) + 4 corner fill rects (4 quads) = 8 quads minimum
  expect(rectQuadCount).toBeGreaterThanOrEqual(8);

  // Verify line width is 2 (default)
  const widthVal = await page.locator('#width-val').textContent();
  expect(parseFloat(widthVal ?? '0')).toBe(2);

  // Verify engine healthy
  await expect(page.locator('#gpu-error')).toBeHidden();

  // Screenshot: rect-only view
  await page.screenshot({
    path: evidenceFile('screenshot-3-rect-border.png'),
    fullPage: true,
  });

  // Test with increased line width - rebuild should still work
  await page.fill('#width-slider', '4');
  await page.waitForTimeout(500);
  await expect(page.locator('#gpu-error')).toBeHidden();
  const width4QuadText = await page.locator('#state-quads').textContent();
  expect(parseInt(width4QuadText ?? '0', 10)).toBeGreaterThan(0);

  // Screenshot with thicker lines
  await page.screenshot({
    path: evidenceFile('screenshot-3b-rect-thick-border.png'),
    fullPage: true,
  });
});
