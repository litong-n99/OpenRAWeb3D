/**
 * Playwright E2E Tests — LightPaletteRotator (E2 + E3)
 *
 * Target: http://localhost:5173/test/ch19-cnc/palette-rotator/
 *
 * E2: rotationIndices sequence — 18 positions, ascending 230→239 then descending 239→231.
 * E3: adjustPalette modifies index 103 — color cycles with rotation.
 *
 * NOTE: rotator/palette are module-scoped (not on window). All verification
 *       goes through DOM status elements.
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

function evidenceFile(name: string): string {
  return path.join(EVIDENCE_DIR, name);
}

async function screenshot(page: any, name: string): Promise<string> {
  const fp = evidenceFile(name);
  await page.screenshot({ path: fp, fullPage: true });
  return fp;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (!m) return null;
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.describe('E2: rotationIndices sequence (18 positions: 230→239 ascending, then 239→231 descending)', () => {
  test('E2-1: sequence length 18', async ({ page }) => {
    test.setTimeout(30000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(PAGE_URL);
    await page.waitForSelector('#info-engine', { timeout: 15000 });

    // Wait for the status panel to be initialized by the render loop.
    await page.waitForFunction(() => {
      const el = document.getElementById('st-seq');
      return el && el.textContent && el.textContent.includes('230');
    }, { timeout: 5000 });

    const seqText = (await page.locator('#st-seq').textContent()) ?? '';

    // Strip brackets and asterisks, split on commas, trim whitespace.
    const cleaned = seqText.replace(/[\[\]\*]/g, '');
    const items = cleaned
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    expect(items).toHaveLength(18);
    expect(items).toEqual([
      '230', '231', '232', '233', '234', '235', '236', '237', '238', '239',
      '238', '237', '236', '235', '234', '233', '232', '231',
    ]);
  });

  test('E2-2: ascending phase (230→239, 10 positions)', async ({ page }) => {
    test.setTimeout(30000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(PAGE_URL);
    await page.waitForSelector('#info-engine', { timeout: 15000 });

    // Pause so we can reset and start from a known state.
    await page.click('#btn-pause');
    await page.click('#btn-reset');
    await page.click('#btn-start');

    // Wait for the peak of the ascending phase (rotationIndex 9 -> source 239).
    await page.waitForFunction(() => {
      const el = document.getElementById('st-ridx');
      return el && el.textContent === '9';
    }, { timeout: 10000 });

    await expect(page.locator('#st-srcidx')).toHaveText('239');

    await screenshot(page, 'screenshot-e2-ascending-peak.png');
  });

  test('E2-3: descending phase (239→231, 8 positions)', async ({ page }) => {
    test.setTimeout(30000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(PAGE_URL);
    await page.waitForSelector('#info-engine', { timeout: 15000 });

    await page.click('#btn-pause');
    await page.click('#btn-reset');
    await page.click('#btn-start');

    // Wait for the first descending position (rotationIndex 10 -> source 238).
    await page.waitForFunction(() => {
      const el = document.getElementById('st-ridx');
      return el && el.textContent === '10';
    }, { timeout: 10000 });

    await expect(page.locator('#st-srcidx')).toHaveText('238');

    // Continue to the end of the descending phase (rotationIndex 17 -> source 231).
    await page.waitForFunction(() => {
      const el = document.getElementById('st-ridx');
      return el && el.textContent === '17';
    }, { timeout: 10000 });

    await expect(page.locator('#st-srcidx')).toHaveText('231');

    await screenshot(page, 'screenshot-e2-descending-end.png');
  });
});

test.describe('E3: adjustPalette modifies index 103', () => {
  test('E3-1: index 103 color cycles with rotation', async ({ page }) => {
    test.setTimeout(30000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(PAGE_URL);
    await page.waitForSelector('#info-engine', { timeout: 15000 });

    await page.click('#btn-pause');
    await page.click('#btn-reset');

    // Check initial state while paused (guaranteed stable)
    await expect(page.locator('#st-srcidx')).toHaveText('230');
    const initialColor = (await page.locator('#st-color').textContent()) ?? '';
    expect(initialColor).toMatch(/^#[0-9a-fA-F]{6}$/);

    // Now start rotation
    await page.click('#btn-start');

    // Wait for a few rotation positions and verify the color changes.
    await page.waitForFunction(() => {
      const el = document.getElementById('st-ridx');
      return el && el.textContent === '3';
    }, { timeout: 10000 });

    const laterColor = (await page.locator('#st-color').textContent()) ?? '';
    expect(laterColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(laterColor).not.toBe(initialColor);

    await screenshot(page, 'screenshot-e3-color-cycle.png');
  });

  test('E3-2: index 103 color at peak (source 239)', async ({ page }) => {
    test.setTimeout(30000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(PAGE_URL);
    await page.waitForSelector('#info-engine', { timeout: 15000 });

    await page.click('#btn-pause');
    await page.click('#btn-reset');

    // Capture the dark-blue color at source 230 (while paused, guaranteed stable).
    await expect(page.locator('#st-srcidx')).toHaveText('230');
    const initialColor = (await page.locator('#st-color').textContent()) ?? '';
    const initialRgb = hexToRgb(initialColor);
    expect(initialRgb).not.toBeNull();

    // Now start rotation
    await page.click('#btn-start');

    // Wait for the peak (source 239).
    await page.waitForFunction(() => {
      const el = document.getElementById('st-ridx');
      return el && el.textContent === '9';
    }, { timeout: 10000 });

    await expect(page.locator('#st-srcidx')).toHaveText('239');

    const peakColor = (await page.locator('#st-color').textContent()) ?? '';
    expect(peakColor).toMatch(/^#[0-9a-fA-F]{6}$/);

    const peakRgb = hexToRgb(peakColor);
    expect(peakRgb).not.toBeNull();

    // At source 239 the generated color is lighter/whiter than at source 230.
    expect(peakRgb!.r + peakRgb!.g + peakRgb!.b).toBeGreaterThan(
      initialRgb!.r + initialRgb!.g + initialRgb!.b
    );
  });

  test('E3-3: index 103 returns to initial after full cycle', async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(PAGE_URL);
    await page.waitForSelector('#info-engine', { timeout: 15000 });

    await page.click('#btn-pause');
    await page.click('#btn-reset');
    await page.click('#btn-start');

    // Use page.evaluate to atomically detect a full cycle (t >= 18.0 at timeStep=0.5)
    const cycleCompleted = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        const check = () => {
          const t = document.getElementById('st-t');
          const ridx = document.getElementById('st-ridx');
          if (t && ridx) {
            const tVal = parseFloat(t.textContent || '0');
            const ridxVal = parseInt(ridx.textContent || '0', 10);
            // t >= 18 means at least one full cycle; ridx=0 means we're back at start
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

    // After full cycle, source index should be back to 230
    await expect(page.locator('#st-srcidx')).toHaveText('230');

    await screenshot(page, 'screenshot-e3-full-cycle.png');
  });
});
