/**
 * Playwright E2E Tests — LightPaletteRotator (Boundary Tests)
 *
 * Target: http://localhost:5173/test/ch19-cnc/palette-rotator/
 *
 * Boundary tests: very slow/fast speeds, non-standard modifyIndex.
 */

import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const PAGE_URL = 'http://localhost:5173/test/ch19-cnc/palette-rotator/';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EVIDENCE_DIR = path.resolve(
  __dirname,
  '../../../test-results/manual/ch19-cnc/palette-rotator/evidence'
);
function evidenceFile(name: string): string { return path.join(EVIDENCE_DIR, name); }

test.beforeAll(() => { fs.mkdirSync(EVIDENCE_DIR, { recursive: true }); });

async function setSliderValue(page: any, id: string, value: string): Promise<void> {
  await page.evaluate(({ id, value }: { id: string; value: string }) => {
    const slider = document.getElementById(id) as HTMLInputElement;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;
    nativeInputValueSetter?.call(slider, value);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, { id, value });
}

test.describe('Boundary tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(PAGE_URL);
    await page.waitForSelector('#st-ridx', { state: 'visible' });
  });

  test('B-1: Very slow timeStep=0.1', async ({ page }) => {
    test.setTimeout(30000);

    await setSliderValue(page, 'rng-speed', '0.1');
    await expect(page.locator('#lbl-speed')).toHaveText('0.1');

    await page.locator('#btn-reset').click();
    await page.locator('#btn-start').click();

    // At timeStep=0.1: 10 ticks (~400ms) × 0.1 = t=1.0, so ridx should be 0 or 1
    await page.waitForTimeout(400);
    const ridx = await page.locator('#st-ridx').textContent();
    expect(parseInt(ridx || '0', 10)).toBeLessThanOrEqual(1);

    // Eventually it should transition away from 0
    await page.waitForFunction(() => {
      const el = document.getElementById('st-ridx');
      return el && el.textContent !== '0';
    }, { timeout: 10000 });

    await page.screenshot({
      path: evidenceFile('screenshot-b1-slow.png'),
      fullPage: true,
    });
  });

  test('B-2: Very fast timeStep=3.0', async ({ page }) => {
    test.setTimeout(30000);

    await setSliderValue(page, 'rng-speed', '3.0');
    await expect(page.locator('#lbl-speed')).toHaveText('3.0');

    await page.locator('#btn-reset').click();
    await page.locator('#btn-start').click();

    // At timeStep=3.0, rotationIndex should advance rapidly.
    // In headless mode timing is unreliable, so we just verify rotation happens.
    await page.waitForFunction(() => {
      const el = document.getElementById('st-ridx');
      return el && el.textContent !== '0';
    }, { timeout: 5000 });

    const ridx = await page.locator('#st-ridx').textContent();
    expect(parseInt(ridx || '0', 10)).toBeGreaterThan(0);

    await page.screenshot({
      path: evidenceFile('screenshot-b2-fast.png'),
      fullPage: true,
    });
  });

  test('B-3: Non-standard modifyIndex=200', async ({ page }) => {
    test.setTimeout(30000);

    await setSliderValue(page, 'rng-modify', '200');
    await expect(page.locator('#lbl-modify')).toHaveText('200');

    await page.locator('#btn-reset').click();
    await page.locator('#btn-start').click();

    // Page should still run without crash
    await expect(page.locator('#st-running')).toHaveText('true');

    // Source index should cycle through 230-239
    await page.waitForFunction(() => {
      const el = document.getElementById('st-srcidx');
      const value = parseInt(el?.textContent ?? '0', 10);
      return value >= 230 && value <= 239;
    }, { timeout: 3000 });

    const srcidx = await page.locator('#st-srcidx').textContent();
    const srcidxNum = parseInt(srcidx ?? '0', 10);
    expect(srcidxNum).toBeGreaterThanOrEqual(230);
    expect(srcidxNum).toBeLessThanOrEqual(239);

    // Rotation should advance
    await page.waitForFunction(() => {
      const el = document.getElementById('st-ridx');
      return el && el.textContent !== '0';
    }, { timeout: 5000 });

    await page.screenshot({
      path: evidenceFile('screenshot-b3-modify-200.png'),
      fullPage: true,
    });
  });
});
