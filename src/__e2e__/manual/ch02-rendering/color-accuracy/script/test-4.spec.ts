/**
 * Playwright E2E Tests — FPS Stability (Expect 4)
 *
 * Target: http://localhost:5173/test/ch02-rendering/color-accuracy/
 *
 * Validates FPS stability under stress:
 *   - FPS stabilizes after page load
 *   - Rapid palette switching does not crash the engine
 *   - Rapid brightness slider dragging does not crash the engine
 *   - FPS never drops to 0
 */

import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const PAGE_URL = 'http://localhost:5173/test/ch02-rendering/color-accuracy/';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EVIDENCE_DIR = path.resolve(
  __dirname,
  '../../../../../../test-results/manual/ch02-rendering/color-accuracy/evidence'
);

function evidenceFile(name: string): string {
  return path.join(EVIDENCE_DIR, name);
}

if (!fs.existsSync(EVIDENCE_DIR)) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

async function readFps(page: any): Promise<number> {
  const text = await page.locator('#info-fps').textContent();
  const val = parseInt(text?.trim() ?? '-1', 10);
  return isNaN(val) ? -1 : val;
}

async function setSliderValue(page: any, selector: string, value: string): Promise<void> {
  await page.locator(selector).evaluate((el: HTMLInputElement, val: string) => {
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

test('fps stability under rapid interactions', async ({ page }) => {
  test.setTimeout(30000);

  await page.goto(PAGE_URL);
  await page.waitForSelector('#info-engine', { timeout: 15000 });

  // 1. Wait for FPS to stabilize
  await page.waitForTimeout(3000);

  const stableFps = await readFps(page);
  expect(stableFps).toBeGreaterThan(0);
  expect(stableFps).not.toBe(-1);

  // 2. Rapidly switch palettes 5 times
  const palettes = ['reference', 'cctd', 'gradient', 'reference', 'cctd'];
  for (const palette of palettes) {
    await page.locator('#palette-select').selectOption(palette);
    await page.waitForTimeout(200);
  }

  await page.waitForTimeout(1000);
  const fpsAfterSwitches = await readFps(page);
  expect(fpsAfterSwitches).toBeGreaterThan(0);
  expect(fpsAfterSwitches).not.toBe(-1);

  // 3. Drag brightness slider rapidly
  const brightnessValues = ['0.00', '0.50', '1.00', '1.50', '2.00', '1.00', '0.00', '1.00'];
  for (const val of brightnessValues) {
    await setSliderValue(page, '#value-mult', val);
    await page.waitForTimeout(50);
  }

  await page.waitForTimeout(1000);
  const fpsAfterDrag = await readFps(page);
  expect(fpsAfterDrag).toBeGreaterThan(0);
  expect(fpsAfterDrag).not.toBe(-1);

  // Verify engine info still present
  const engineInfo = await page.locator('#info-engine').textContent();
  expect(engineInfo).toMatch(/Babylon\.js/);

  await page.screenshot({
    path: evidenceFile('screenshot-fps-stability.png'),
    fullPage: true,
  });
});
