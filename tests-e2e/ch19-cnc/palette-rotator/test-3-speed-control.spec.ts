/**
 * Playwright E2E Tests — LightPaletteRotator (E5: Speed Control)
 *
 * Target: http://localhost:5173/test/ch19-cnc/palette-rotator/
 *
 * E5: Speed adjustment via timeStep slider
 *     - timeStep=0.5: ~80ms per transition (2 ticks)
 *     - timeStep=1.0: ~40ms per transition (1 tick)
 *     - timeStep=2.0: very fast (2 transitions per tick)
 *     - timeStep=0.1: very slow (10 ticks per transition)
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

async function setSpeed(page: any, value: string): Promise<void> {
  await page.evaluate((val: string) => {
    const slider = document.getElementById('rng-speed') as HTMLInputElement;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;
    nativeInputValueSetter?.call(slider, val);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test.describe('E5: Speed adjustment via timeStep slider', () => {
  test('E5-1: timeStep=0.5 (default) — rotationIndex transitions at ~40ms per tick', async ({ page }) => {
    test.setTimeout(30000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(PAGE_URL);
    await page.waitForSelector('#st-ridx', { state: 'visible' });

    await page.locator('#btn-pause').click();
    await setSpeed(page, '0.5');
    await page.locator('#btn-reset').click();

    // Verify reset state while paused
    await expect(page.locator('#st-ridx')).toHaveText('0');

    // Start and wait for rotationIndex to transition 0→1→2
    await page.locator('#btn-start').click();
    await page.waitForFunction(() => {
      const el = document.getElementById('st-ridx');
      return el && el.textContent === '1';
    }, { timeout: 5000 });
    await expect(page.locator('#st-srcidx')).toHaveText('231');

    await page.waitForFunction(() => {
      const el = document.getElementById('st-ridx');
      return el && el.textContent === '2';
    }, { timeout: 5000 });
    await expect(page.locator('#st-srcidx')).toHaveText('232');
  });

  test('E5-2: timeStep=1.0 — faster cycle (18 ticks per full cycle)', async ({ page }) => {
    test.setTimeout(30000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(PAGE_URL);
    await page.waitForSelector('#st-ridx', { state: 'visible' });

    await page.locator('#btn-pause').click();
    await setSpeed(page, '1.0');
    await expect(page.locator('#lbl-speed')).toHaveText('1.0');

    await page.locator('#btn-reset').click();
    await page.locator('#btn-start').click();

    // Use page.evaluate to atomically watch for a full cycle at timeStep=1.0
    // At timeStep=1.0, each tick advances t by 1.0, so full cycle (18 indices) = t >= 18.0
    const cycleCompleted = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        const check = () => {
          const t = document.getElementById('st-t');
          const ridx = document.getElementById('st-ridx');
          if (t && ridx) {
            const tVal = parseFloat(t.textContent || '0');
            const ridxVal = parseInt(ridx.textContent || '0', 10);
            if (tVal >= 18.0 && ridxVal === 0) {
              resolve(true);
              return;
            }
          }
          requestAnimationFrame(check);
        };
        check();
      });
    });
    expect(cycleCompleted).toBe(true);
  });

  test('E5-3: timeStep=2.0 — very fast', async ({ page }) => {
    test.setTimeout(30000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(PAGE_URL);
    await page.waitForSelector('#st-ridx', { state: 'visible' });

    await page.locator('#btn-pause').click();
    await setSpeed(page, '2.0');
    await expect(page.locator('#lbl-speed')).toHaveText('2.0');

    await page.locator('#btn-reset').click();
    await page.locator('#btn-start').click();

    // Use page.evaluate to atomically detect that rotation is happening at timeStep=2.0
    const rotationDetected = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        const start = Date.now();
        const check = () => {
          const ridx = document.getElementById('st-ridx');
          if (ridx && ridx.textContent !== '0') {
            resolve(true);
            return;
          }
          if (Date.now() - start > 5000) {
            resolve(false);
            return;
          }
          requestAnimationFrame(check);
        };
        check();
      });
    });
    expect(rotationDetected).toBe(true);

    await page.screenshot({
      path: evidenceFile('screenshot-e5-fast.png'),
      fullPage: true,
    });
  });

  test('E5-4: timeStep=0.1 — very slow', async ({ page }) => {
    test.setTimeout(30000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(PAGE_URL);
    await page.waitForSelector('#st-ridx', { state: 'visible' });

    await setSpeed(page, '0.1');
    await expect(page.locator('#lbl-speed')).toHaveText('0.1');

    await page.locator('#btn-reset').click();
    await page.locator('#btn-start').click();
    await expect(page.locator('#st-running')).toHaveText('true');

    // At timeStep=0.1, 10 ticks = ~400ms before first transition
    await page.waitForTimeout(400);
    const ridx = await page.locator('#st-ridx').textContent();
    // Should still be 0 or just transitioning to 1
    expect(parseInt(ridx || '0', 10)).toBeLessThanOrEqual(1);

    await page.screenshot({
      path: evidenceFile('screenshot-e5-slow.png'),
      fullPage: true,
    });
  });
});
