/**
 * Playwright E2E Tests — Display Options (Expect 5)
 *
 * Target: http://localhost:5173/test/ch02-rendering/color-accuracy/
 *
 * Validates display controls:
 *   - Toggle show-indices checkbox
 *   - Toggle show-grid checkbox
 *   - Adjust zoom slider (2.0x, 0.5x)
 *   - Screenshot with indices off, grid on
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

async function setSliderValue(page: any, selector: string, value: string): Promise<void> {
  await page.locator(selector).evaluate((el: HTMLInputElement, val: string) => {
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

test('display options toggle and zoom', async ({ page }) => {
  test.setTimeout(30000);

  await page.goto(PAGE_URL);
  await page.waitForSelector('#info-engine', { timeout: 15000 });
  await page.waitForTimeout(800);

  // Initial state
  await expect(page.locator('#show-indices')).toBeChecked();
  await expect(page.locator('#show-grid')).toBeChecked();

  // 1. Toggle indices off
  await page.locator('#show-indices').uncheck();
  await page.waitForTimeout(200);
  await expect(page.locator('#show-indices')).not.toBeChecked();

  // 2. Toggle indices back on
  await page.locator('#show-indices').check();
  await page.waitForTimeout(200);
  await expect(page.locator('#show-indices')).toBeChecked();

  // 3. Toggle grid off
  await page.locator('#show-grid').uncheck();
  await page.waitForTimeout(200);
  await expect(page.locator('#show-grid')).not.toBeChecked();

  // 4. Toggle grid back on
  await page.locator('#show-grid').check();
  await page.waitForTimeout(200);
  await expect(page.locator('#show-grid')).toBeChecked();

  // 5. Zoom to 2.0x
  await setSliderValue(page, '#zoom-slider', '2.0');
  await page.waitForTimeout(200);
  await expect(page.locator('#zoom-val')).toHaveText('2.0x');

  // 6. Zoom to 0.5x
  await setSliderValue(page, '#zoom-slider', '0.5');
  await page.waitForTimeout(200);
  await expect(page.locator('#zoom-val')).toHaveText('0.5x');

  // Reset zoom to 1.0x for final screenshot
  await setSliderValue(page, '#zoom-slider', '1.0');
  await page.waitForTimeout(200);
  await expect(page.locator('#zoom-val')).toHaveText('1.0x');

  // Final state: indices off, grid on
  await page.locator('#show-indices').uncheck();
  await page.waitForTimeout(200);
  await expect(page.locator('#show-indices')).not.toBeChecked();
  await expect(page.locator('#show-grid')).toBeChecked();

  await page.screenshot({
    path: evidenceFile('screenshot-display-indices-off-grid-on.png'),
    fullPage: true,
  });
});
