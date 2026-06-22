/**
 * Playwright E2E Tests — RgbaColorRenderer FPS Stability (Expect 4)
 *
 * Target: http://localhost:5173/test/ch02-rendering/rgba-alpha-blending/
 *
 * Validates that the page maintains an FPS of at least 55 after the render
 * loop has had at least 3 seconds to stabilize.
 */

import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const PAGE_URL = 'http://localhost:5173/test/ch02-rendering/rgba-alpha-blending/';
const EVIDENCE_DIR = path.resolve(
  'test-results/manual/ch02-rendering/rgba-alpha-blending/evidence'
);

function evidenceFile(name: string): string {
  return path.join(EVIDENCE_DIR, name);
}

if (!fs.existsSync(EVIDENCE_DIR)) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

test('FPS is at least 55 after stabilization', async ({ page }) => {
  test.setTimeout(30000);

  await page.goto(PAGE_URL);
  await page.waitForSelector('#info-engine', { timeout: 15000 });

  // Wait at least 3 seconds for the FPS counter to stabilize
  await page.waitForTimeout(3500);

  // Read FPS from the DOM and via JavaScript variable
  const fpsText = await page.locator('#info-fps').textContent();
  const fpsDom = fpsText ? parseInt(fpsText, 10) : 0;

  const fpsViaJs = await page.evaluate(() => {
    const text = document.getElementById('info-fps')?.textContent ?? '';
    const parsed = parseInt(text, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });

  expect(fpsDom, `FPS from DOM (${fpsDom}) must be >= 55`).toBeGreaterThanOrEqual(55);
  expect(fpsViaJs, `FPS from JS (${fpsViaJs}) must be >= 55`).toBeGreaterThanOrEqual(55);

  await page.screenshot({
    path: evidenceFile('screenshot-fps-stable.png'),
    fullPage: true,
  });
});
