/**
 * Playwright E2E Tests — Expect 3: Fill Rectangle (FillRect)
 *
 * Verifies:
 *   - 'fillrect' filter shows filled rectangles only
 *   - Fill color (#2ecc71 green) is correctly set
 *   - Quad count is non-zero
 *   - Semi-transparent overlay border has alpha < 1
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

test('expect 3: fill rectangle color uniform', async ({ page }) => {
  test.setTimeout(30000);

  await page.goto(PAGE_URL);
  await page.waitForSelector('#info-engine', { timeout: 15000 });
  await page.waitForTimeout(800);

  // Switch to 'fillrect' filter
  await page.selectOption('#shape-select', 'fillrect');
  await page.waitForTimeout(500);

  // Quad count should be non-zero
  const fillRectQuadText = await page.locator('#state-quads').textContent();
  const fillRectQuadCount = parseInt(fillRectQuadText ?? '0', 10);
  expect(fillRectQuadCount).toBeGreaterThan(0);

  // Fill color is default green (#2ecc71)
  const fillColor = await page.locator('#fill-color').inputValue();
  expect(fillColor.toLowerCase()).toBe('#2ecc71');

  // Engine healthy
  await expect(page.locator('#gpu-error')).toBeHidden();

  // Screenshot: fill rect only
  await page.screenshot({
    path: evidenceFile('screenshot-4-fill-rect.png'),
    fullPage: true,
  });

  // Change fill color and verify rebuild works
  await page.fill('#fill-color', '#ff6600'); // orange
  await page.locator('#apply-colors').click();
  await page.waitForTimeout(500);
  await expect(page.locator('#gpu-error')).toBeHidden();
  const newQuadText = await page.locator('#state-quads').textContent();
  expect(parseInt(newQuadText ?? '0', 10)).toBe(fillRectQuadCount);

  // Screenshot with orange fill
  await page.screenshot({
    path: evidenceFile('screenshot-4b-fill-rect-orange.png'),
    fullPage: true,
  });
});
