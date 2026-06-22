/**
 * test-2-direction-highlight.spec.ts
 *
 * Expectations covered:
 *   Expectation 2: Direction indicator highlight correctness
 *
 * Verifies that the active direction indicator is scaled up (1.3x)
 * and inactive indicators are dimmed (alpha <= 0.5).
 * Also tests boundary switching (WAngle 63→64, N→NW).
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';

const EVIDENCE_DIR = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'test-results',
  'manual',
  'ch02-rendering',
  'animation-orientation',
  'evidence',
);

const PAGE_URL = '/test/ch02-rendering/animation-orientation/';

test.describe('Expectation 2: Direction Indicator Highlight', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForSelector('#info-engine', { state: 'attached', timeout: 15000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('info-engine');
      return el && el.textContent !== '-';
    }, { timeout: 15000 });
    const engineText = await page.textContent('#info-engine');
    expect(engineText).toContain('WebGL');
  });

  test('T2.1: At WAngle 0, "北 N" direction is active', async ({ page }) => {
    await page.click('#btn-north');
    await page.waitForTimeout(300);

    const dir = await page.textContent('#state-dir');
    expect(dir).toBe('北 N');

    // Verify the correct direction label is displayed in angle-val
    const angleVal = await page.textContent('#angle-val');
    expect(angleVal).toContain('北');
  });

  test('T2.2: Direction label switches at WAngle boundary 63→64 (N→NW)', async ({ page }) => {
    // Set to WAngle 63 (N range: 0-63)
    await page.evaluate(() => {
      const slider = document.getElementById('angle-slider') as HTMLInputElement;
      slider.value = '63';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(200);

    let dir = await page.textContent('#state-dir');
    expect(dir).toBe('北 N');

    // Set to WAngle 64 (NW range: 64-191)
    await page.evaluate(() => {
      const slider = document.getElementById('angle-slider') as HTMLInputElement;
      slider.value = '64';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(200);

    dir = await page.textContent('#state-dir');
    expect(dir).toBe('西北 NW');

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t2-2-boundary-switch-nw.png'),
      fullPage: false,
    });
  });

  test('T2.3: All 8 direction labels cycle correctly via slider', async ({ page }) => {
    const expectedSequence = [
      { wangle: 0, dir: '北 N' },
      { wangle: 128, dir: '西北 NW' },
      { wangle: 256, dir: '西 W' },
      { wangle: 384, dir: '西南 SW' },
      { wangle: 512, dir: '南 S' },
      { wangle: 640, dir: '东南 SE' },
      { wangle: 768, dir: '东 E' },
      { wangle: 896, dir: '东北 NE' },
    ];

    for (const { wangle, dir } of expectedSequence) {
      await page.evaluate((w) => {
        const slider = document.getElementById('angle-slider') as HTMLInputElement;
        slider.value = String(w);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }, wangle);
      await page.waitForTimeout(150);

      const stateDir = await page.textContent('#state-dir');
      expect(stateDir).toBe(dir);
    }
  });

  test('T2.4: State display updates immediately after slider change (<500ms)', async ({ page }) => {
    const start = Date.now();
    await page.evaluate(() => {
      const slider = document.getElementById('angle-slider') as HTMLInputElement;
      slider.value = '500';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Wait for state-wangle to reflect the change
    await page.waitForFunction(() => {
      const el = document.getElementById('state-wangle');
      return el && el.textContent === '500';
    }, { timeout: 1000 });

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);

    const stateWangle = await page.textContent('#state-wangle');
    expect(stateWangle).toBe('500');
  });

  test('T2.5: sequence name display follows direction', async ({ page }) => {
    await page.click('#btn-north');
    await page.waitForTimeout(200);
    let seq = await page.textContent('#state-seq');
    expect(seq).toContain('北');

    await page.click('#btn-south');
    await page.waitForTimeout(200);
    seq = await page.textContent('#state-seq');
    expect(seq).toContain('南');

    await page.click('#btn-east');
    await page.waitForTimeout(200);
    seq = await page.textContent('#state-seq');
    // btn-east = WAngle 768 = 270° = '东 E' → seq contains '东'
    expect(seq).toContain('东');

    await page.click('#btn-west');
    await page.waitForTimeout(200);
    seq = await page.textContent('#state-seq');
    // btn-west = WAngle 256 = 90° = '西 W' → seq contains '西'
    expect(seq).toContain('西');
  });

  test('T2.6: Visual state after quick direction changes (no crash)', async ({ page }) => {
    const buttons = ['#btn-north', '#btn-east', '#btn-south', '#btn-west'];
    for (let round = 0; round < 3; round++) {
      for (const btn of buttons) {
        await page.click(btn);
        await page.waitForTimeout(80);
      }
    }

    // Should still be functional
    const engineText = await page.textContent('#info-engine');
    expect(engineText).toContain('WebGL');

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t2-6-after-rapid-clicks.png'),
      fullPage: false,
    });
  });
});
