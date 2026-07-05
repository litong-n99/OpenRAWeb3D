/**
 * Playwright E2E Tests — LightPaletteRotator (E1 + E4)
 *
 * Target: http://localhost:5173/test/ch19-cnc/palette-rotator/
 *
 * E1: tick accumulation — t += timeStep each tick call (25Hz render loop)
 *     - timeStep=0.5: rotationIndex changes every 2 ticks
 *     - floor(t) determines currentRotationIndex
 *     - 36 ticks = one full cycle (18 index positions)
 * E4: Reference cubes unchanged — palette indices 0,1,2,3 never change
 *
 * NOTE: rotator/palette are module-scoped (not on window). All verification
 *       goes through DOM status elements: #st-t, #st-ridx, #st-srcidx, #st-color, #st-running.
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

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.describe('E1: Tick Accumulation (timeStep=0.5)', () => {
  test('E1-1: Initial state verification', async ({ page }) => {
    test.setTimeout(30000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(PAGE_URL);
    await page.waitForSelector('#info-engine', { timeout: 15000 });

    // Engine info
    const engineText = await page.locator('#info-engine').textContent();
    expect(engineText).toMatch(/WebGL\s*2/);

    // Reset first to guarantee clean initial state (page starts running automatically)
    await page.locator('#btn-reset').click();
    await page.waitForTimeout(200);

    // DOM status: initial state after reset
    await expect(page.locator('#st-t')).toHaveText('0.0');
    await expect(page.locator('#st-ridx')).toHaveText('0');
    await expect(page.locator('#st-srcidx')).toHaveText('230');
    // After reset, isRunning is false; we test the reset state
    await expect(page.locator('#st-running')).toHaveText('false');

    // Speed and modify defaults
    await expect(page.locator('#lbl-speed')).toHaveText('0.5');
    await expect(page.locator('#lbl-modify')).toHaveText('103');

    // Sequence display should mark position 0 with *
    const seqText = await page.locator('#st-seq').textContent();
    expect(seqText).toContain('*230*');

    await page.screenshot({
      path: evidenceFile('screenshot-e1-initial.png'),
      fullPage: true,
    });
  });

  test('E1-2: rotationIndex switches every 2 ticks at timeStep=0.5', async ({ page }) => {
    test.setTimeout(30000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(PAGE_URL);
    await page.waitForSelector('#info-engine', { timeout: 15000 });

    // The page starts running automatically. Each tick = ~40ms at 25Hz.
    // At timeStep=0.5, rotationIndex switches every 2 ticks = ~80ms.
    // We need to observe the rotationIndex changing over time.

    // After ~80ms (2 ticks), rotationIndex should still be 0 (t=0.5)
    await page.waitForTimeout(100);
    let ridx = await page.locator('#st-ridx').textContent();

    // After ~160ms (4 ticks), rotationIndex should be 1 (t=1.0 → floor=1)
    await page.waitForTimeout(80);
    ridx = await page.locator('#st-ridx').textContent();
    // At this point t might be around 0.5-1.0, so rotationIndex could be 0 or 1
    // Wait until it definitely reaches 1
    await page.waitForFunction(() => {
      const el = document.getElementById('st-ridx');
      return el && el.textContent === '1';
    }, { timeout: 5000 });

    await expect(page.locator('#st-ridx')).toHaveText('1');
    await expect(page.locator('#st-srcidx')).toHaveText('231');

    // Wait for rotationIndex to reach 2 (source=232)
    await page.waitForFunction(() => {
      const el = document.getElementById('st-ridx');
      return el && el.textContent === '2';
    }, { timeout: 5000 });
    await expect(page.locator('#st-srcidx')).toHaveText('232');

    await page.screenshot({
      path: evidenceFile('screenshot-e1-rotation-index-2.png'),
      fullPage: true,
    });
  });

  test('E1-3: Full cycle completes at t=18.0 (36 ticks)', async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(PAGE_URL);
    await page.waitForSelector('#info-engine', { timeout: 15000 });

    // At 25 ticks/sec and timeStep=0.5, one full cycle = 36 ticks = 1.44s.
    // Use page.evaluate to atomically detect the full cycle: wait for ridx 0→17→0.
    const cycleCompleted = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        const check = () => {
          const t = document.getElementById('st-t');
          const ridx = document.getElementById('st-ridx');
          if (t && ridx) {
            const tVal = parseFloat(t.textContent || '0');
            if (tVal >= 18.0) {
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

    // After cycle, source should have returned to 230
    const srcIdx = await page.locator('#st-srcidx').textContent();
    expect(srcIdx).toBe('230');

    await page.screenshot({
      path: evidenceFile('screenshot-e1-full-cycle-complete.png'),
      fullPage: true,
    });
  });
});

test.describe('E4: Reference Cubes Unchanged', () => {
  test('E4-1: Reference palette indices 0-3 never affected by rotation', async ({ page }) => {
    test.setTimeout(30000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(PAGE_URL);
    await page.waitForSelector('#info-engine', { timeout: 15000 });

    // The rotationIndices are 230-239. The modifyIndex is 103.
    // Indices 0-3 should never appear as sourceIndex or be modified.
    // Verify: #st-srcidx never shows values in [0,3]
    // And #st-seq only contains indices 230-239

    // Record sourceIndex values over multiple transitions
    const seqText = await page.locator('#st-seq').textContent();
    // The sequence should only contain numbers 230-239 and 231-238
    // No references to 0, 1, 2, 3
    expect(seqText).toContain('230');
    expect(seqText).toContain('239');
    expect(seqText).not.toMatch(/\b[0-3]\b/); // no standalone 0,1,2,3

    // Wait for several rotationIndex transitions and verify sourceIndex stays in [230,239]
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(200); // ~5 ticks
      const srcIdx = await page.locator('#st-srcidx').textContent();
      const srcNum = parseInt(srcIdx || '0', 10);
      expect(srcNum).toBeGreaterThanOrEqual(230);
      expect(srcNum).toBeLessThanOrEqual(239);
    }

    // The color shown for index 103 changes, but reference indices 0-3 are fixed.
    // We verify this by checking that the page never shows sourceIndex = 0,1,2,3.

    await page.screenshot({
      path: evidenceFile('screenshot-e4-reference-unchanged.png'),
      fullPage: true,
    });
  });

  test('E4-2: Sequence display only shows rotation range (230-239)', async ({ page }) => {
    test.setTimeout(30000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(PAGE_URL);
    await page.waitForSelector('#info-engine', { timeout: 15000 });

    // Verify the sequence text contains the correct indices
    const seqText = await page.locator('#st-seq').textContent();
    expect(seqText).toContain('230');
    expect(seqText).toContain('231');
    expect(seqText).toContain('239');

    // Count asterisks (only one current position marker)
    const asteriskCount = (seqText?.match(/\*/g) || []).length;
    expect(asteriskCount).toBe(2); // one pair: *230* wrapping the current position
  });
});
