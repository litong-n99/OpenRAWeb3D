/**
 * Playwright E2E Tests — PlayerColorRemap (Expect 3 + boundary)
 *
 * Target: http://localhost:5173/test/ch02-rendering/color-accuracy/
 *
 * Validates PlayerColorRemap behavior on the C&C TD palette:
 *   - Switch to cctd palette
 *   - Apply player colors (red, blue, green)
 *   - Verify apply button active state and remapped texture update
 *   - Brightness scaling (0.50, 1.50)
 *   - Extreme remap ranges (0-0, 0-255)
 *   - Reset behavior
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

test('player color remap and boundary cases', async ({ page }) => {
  test.setTimeout(30000);

  const updateMessages: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[updateTexture] texRemapped')) {
      updateMessages.push(text);
    }
  });

  await page.goto(PAGE_URL);
  await page.waitForSelector('#info-engine', { timeout: 15000 });

  // 1. Switch to C&C TD palette
  await page.locator('#palette-select').selectOption('cctd');
  await page.waitForTimeout(1000);
  await expect(page.locator('#palette-select')).toHaveValue('cctd');

  // 2. Apply red player color (#e94560)
  await page.locator('#player-color').fill('#e94560');
  await page.locator('#apply-remap').click();
  await page.waitForTimeout(600);

  await expect(page.locator('#apply-remap')).toHaveClass(/active/);
  expect(updateMessages.some((m) => m.includes('texRemapped'))).toBe(true);

  await page.screenshot({
    path: evidenceFile('screenshot-remap-red.png'),
    fullPage: true,
  });

  // 3. Apply blue player color (#3366ff)
  updateMessages.length = 0;
  await page.locator('#player-color').fill('#3366ff');
  await page.locator('#apply-remap').click();
  await page.waitForTimeout(600);
  expect(updateMessages.some((m) => m.includes('texRemapped'))).toBe(true);

  await page.screenshot({
    path: evidenceFile('screenshot-remap-blue.png'),
    fullPage: true,
  });

  // 4. Apply green player color (#33cc33)
  updateMessages.length = 0;
  await page.locator('#player-color').fill('#33cc33');
  await page.locator('#apply-remap').click();
  await page.waitForTimeout(600);
  expect(updateMessages.some((m) => m.includes('texRemapped'))).toBe(true);

  await page.screenshot({
    path: evidenceFile('screenshot-remap-green.png'),
    fullPage: true,
  });

  // 5. Brightness 0.50
  await setSliderValue(page, '#value-mult', '0.50');
  await expect(page.locator('#vm-val')).toHaveText('0.50');
  updateMessages.length = 0;
  await page.locator('#apply-remap').click();
  await page.waitForTimeout(600);
  expect(updateMessages.some((m) => m.includes('texRemapped'))).toBe(true);

  await page.screenshot({
    path: evidenceFile('screenshot-remap-brightness-0.50.png'),
    fullPage: true,
  });

  // 6. Brightness 1.50
  await setSliderValue(page, '#value-mult', '1.50');
  await expect(page.locator('#vm-val')).toHaveText('1.50');
  updateMessages.length = 0;
  await page.locator('#apply-remap').click();
  await page.waitForTimeout(600);
  expect(updateMessages.some((m) => m.includes('texRemapped'))).toBe(true);

  await page.screenshot({
    path: evidenceFile('screenshot-remap-brightness-1.50.png'),
    fullPage: true,
  });

  // 7. Extreme remap range 0-0
  await setSliderValue(page, '#remap-range-start', '0');
  await setSliderValue(page, '#remap-range-end', '0');
  await expect(page.locator('#remap-range-label')).toHaveText('0-0');
  updateMessages.length = 0;
  await page.locator('#apply-remap').click();
  await page.waitForTimeout(600);
  expect(updateMessages.some((m) => m.includes('texRemapped'))).toBe(true);

  await page.screenshot({
    path: evidenceFile('screenshot-remap-range-0-0.png'),
    fullPage: true,
  });

  // 8. Extreme remap range 0-255
  await setSliderValue(page, '#remap-range-start', '0');
  await setSliderValue(page, '#remap-range-end', '255');
  await expect(page.locator('#remap-range-label')).toHaveText('0-255');
  updateMessages.length = 0;
  await page.locator('#apply-remap').click();
  await page.waitForTimeout(600);
  expect(updateMessages.some((m) => m.includes('texRemapped'))).toBe(true);

  await page.screenshot({
    path: evidenceFile('screenshot-remap-range-0-255.png'),
    fullPage: true,
  });

  // 9. Reset to original palette
  await page.locator('#reset-remap').click();
  await page.waitForTimeout(600);
  await expect(page.locator('#apply-remap')).not.toHaveClass(/active/);

  await page.screenshot({
    path: evidenceFile('screenshot-remap-reset.png'),
    fullPage: true,
  });
});
