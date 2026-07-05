/**
 * Playwright E2E Tests — LightPaletteRotator (E6: Pause/Resume/Reset)
 *
 * Target: http://localhost:5173/test/ch19-cnc/palette-rotator/
 *
 * E6: Pause stops tick accumulation, Resume continues, Reset restores initial state.
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

test.describe('E6: Pause/Resume/Reset', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(PAGE_URL);
    await page.waitForSelector('#st-ridx', { state: 'visible' });
  });

  test('E6-1: Pause stops tick accumulation', async ({ page }) => {
    test.setTimeout(30000);

    await page.locator('#btn-reset').click();
    await page.locator('#btn-start').click();
    await expect(page.locator('#st-running')).toHaveText('true');

    // Wait until rotationIndex becomes 2
    await page.waitForFunction(() => {
      const el = document.getElementById('st-ridx');
      return el && el.textContent === '2';
    }, { timeout: 5000 });

    await page.locator('#btn-pause').click();
    await expect(page.locator('#st-running')).toHaveText('false');

    const tAtPause = await page.locator('#st-t').textContent();
    const ridxAtPause = await page.locator('#st-ridx').textContent();

    // Wait 500ms and verify state is frozen
    await page.waitForTimeout(500);

    const tAfterWait = await page.locator('#st-t').textContent();
    const ridxAfterWait = await page.locator('#st-ridx').textContent();

    expect(tAfterWait).toBe(tAtPause);
    expect(ridxAfterWait).toBe(ridxAtPause);

    await page.screenshot({
      path: evidenceFile('screenshot-e6-paused.png'),
      fullPage: true,
    });
  });

  test('E6-2: Resume continues from pause point', async ({ page }) => {
    test.setTimeout(30000);

    await page.locator('#btn-reset').click();
    await page.locator('#btn-start').click();

    // Advance to rotationIndex 2, then pause
    await page.waitForFunction(() => {
      const el = document.getElementById('st-ridx');
      return el && el.textContent === '2';
    }, { timeout: 5000 });

    await page.locator('#btn-pause').click();
    await expect(page.locator('#st-running')).toHaveText('false');

    const tAtPause = await page.locator('#st-t').textContent();
    const ridxAtPause = await page.locator('#st-ridx').textContent();

    // Resume
    await page.locator('#btn-start').click();
    await expect(page.locator('#st-running')).toHaveText('true');

    // Verify t increases
    await page.waitForFunction((pausedT: string) => {
      const el = document.getElementById('st-t');
      return el && el.textContent !== pausedT;
    }, tAtPause, { timeout: 3000 });

    const tAfterResume = await page.locator('#st-t').textContent();
    expect(tAfterResume).not.toBe(tAtPause);

    // Verify rotationIndex advances
    await page.waitForFunction((pausedRidx: string) => {
      const el = document.getElementById('st-ridx');
      return el && el.textContent !== pausedRidx;
    }, ridxAtPause, { timeout: 3000 });

    const ridxAfterResume = await page.locator('#st-ridx').textContent();
    expect(ridxAfterResume).not.toBe(ridxAtPause);

    await page.screenshot({
      path: evidenceFile('screenshot-e6-resumed.png'),
      fullPage: true,
    });
  });

  test('E6-3: Reset restores initial state', async ({ page }) => {
    test.setTimeout(30000);

    // Start running and advance
    await page.locator('#btn-reset').click();
    await page.locator('#btn-start').click();
    await expect(page.locator('#st-running')).toHaveText('true');

    await page.waitForFunction(() => {
      const el = document.getElementById('st-ridx');
      return el && el.textContent === '2';
    }, { timeout: 5000 });

    // Reset
    await page.locator('#btn-reset').click();

    await expect(page.locator('#st-t')).toHaveText('0.0');
    await expect(page.locator('#st-ridx')).toHaveText('0');
    await expect(page.locator('#st-srcidx')).toHaveText('230');
    await expect(page.locator('#st-running')).toHaveText('false');

    await page.screenshot({
      path: evidenceFile('screenshot-e6-reset.png'),
      fullPage: true,
    });
  });
});
