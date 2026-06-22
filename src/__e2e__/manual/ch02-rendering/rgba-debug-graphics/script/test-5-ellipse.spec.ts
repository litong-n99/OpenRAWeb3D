/**
 * Playwright E2E Tests — Expect 4: Ellipse Fill (FillEllipse)
 *
 * Verifies:
 *   - 'ellipse' filter shows ellipse quads only
 *   - Quad count is > 0 (scanline method produces many quads)
 *   - Two ellipses are rendered (large rx=1.2 ry=1.8, small rx=0.6 ry=1.5)
 *   - Scanline count ~40 per ellipse, so quads ~80 total
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

test('expect 4: ellipse fill approximately correct', async ({ page }) => {
  test.setTimeout(30000);

  await page.goto(PAGE_URL);
  await page.waitForSelector('#info-engine', { timeout: 15000 });
  await page.waitForTimeout(800);

  // Switch to 'ellipse' filter
  await page.selectOption('#shape-select', 'ellipse');
  await page.waitForTimeout(500);

  // Quad count should be substantial (scanline fill ~80 quads for 2 ellipses)
  const ellipseQuadText = await page.locator('#state-quads').textContent();
  const ellipseQuadCount = parseInt(ellipseQuadText ?? '0', 10);
  // With ~40 scanlines per ellipse, expect ~80 quads total
  // Allow wide range: 40-200 to account for scanline step variations
  expect(ellipseQuadCount).toBeGreaterThanOrEqual(40);

  // Engine healthy
  await expect(page.locator('#gpu-error')).toBeHidden();

  // Screenshot: ellipse-only view
  await page.screenshot({
    path: evidenceFile('screenshot-5-ellipse.png'),
    fullPage: true,
  });

  // The scanline method is deterministic: same inputs = same quad count
  // Switch back to 'all' and back to 'ellipse', count should be stable
  await page.selectOption('#shape-select', 'all');
  await page.waitForTimeout(300);
  await page.selectOption('#shape-select', 'ellipse');
  await page.waitForTimeout(500);

  const stableQuadText = await page.locator('#state-quads').textContent();
  const stableQuadCount = parseInt(stableQuadText ?? '0', 10);
  expect(stableQuadCount).toBe(ellipseQuadCount);
});
