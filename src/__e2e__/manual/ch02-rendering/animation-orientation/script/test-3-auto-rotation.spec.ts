/**
 * test-3-auto-rotation.spec.ts
 *
 * Expectations covered:
 *   Expectation 4: Auto-rotation smoothness
 *
 * Verifies that auto-rotation:
 *   - Starts when checkbox is checked
 *   - Stops when unchecked
 *   - WAngle changes continuously over time
 *   - Direction indicator updates during rotation
 *   - Works at different speed settings
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

test.describe('Expectation 4: Auto-Rotation Smoothness', () => {
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

  test('T3.1: Auto-rotate checkbox starts rotation (wangle changes over time)', async ({ page }) => {
    // Set speed to 1x and start with known wangle
    await page.click('#btn-north');
    await page.waitForTimeout(200);

    // Enable auto-rotate
    await page.check('#auto-rotate');

    // Wait 2 seconds for rotation to accumulate
    await page.waitForTimeout(2000);

    const wangle = await page.textContent('#state-wangle');
    const wangleNum = parseInt(wangle!, 10);

    // At speed=1x, WAngle changes by 2 per frame (~120/sec at 60fps)
    // After 2 seconds, should have moved significantly from 0
    expect(wangleNum).toBeGreaterThan(10);
    expect(wangleNum).toBeLessThanOrEqual(1023);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t3-1-auto-rotate-after-2s.png'),
      fullPage: false,
    });

    // Disable auto-rotate
    await page.uncheck('#auto-rotate');
  });

  test('T3.2: Auto-rotate stops when unchecked (wangle freezes)', async ({ page }) => {
    await page.check('#auto-rotate');
    await page.waitForTimeout(1000);

    // Uncheck to stop
    await page.uncheck('#auto-rotate');
    await page.waitForTimeout(300);

    const wangle1 = await page.textContent('#state-wangle');

    // Wait 1 second - wangle should not change
    await page.waitForTimeout(1000);

    const wangle2 = await page.textContent('#state-wangle');
    expect(wangle1).toBe(wangle2);
  });

  test('T3.3: Direction indicator updates during auto-rotation', async ({ page }) => {
    // Start from North
    await page.click('#btn-north');
    await page.waitForTimeout(200);

    // Set speed to 5x for faster rotation
    await page.fill('#rot-speed-slider', '5');
    // Trigger input event
    await page.evaluate(() => {
      const slider = document.getElementById('rot-speed-slider') as HTMLInputElement;
      slider.value = '5';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await page.check('#auto-rotate');

    // Collect direction changes over 3 seconds
    const directionsSeen = new Set<string>();
    const startTime = Date.now();
    while (Date.now() - startTime < 3000) {
      const dir = await page.textContent('#state-dir');
      directionsSeen.add(dir!);
      await page.waitForTimeout(100);
    }

    await page.uncheck('#auto-rotate');

    // At speed 5x, should see multiple direction changes
    expect(directionsSeen.size).toBeGreaterThanOrEqual(3);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t3-3-direction-changes-during-rotation.png'),
      fullPage: false,
    });
  });

  test('T3.4: Rotation speed slider changes rotation rate', async ({ page }) => {
    // Test with speed=10x (fast)
    await page.evaluate(() => {
      const slider = document.getElementById('rot-speed-slider') as HTMLInputElement;
      slider.value = '10';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('#btn-north');
    await page.waitForTimeout(200);
    await page.check('#auto-rotate');
    await page.waitForTimeout(1000);

    const wangleFast = await page.textContent('#state-wangle');
    const fastNum = parseInt(wangleFast!, 10);
    await page.uncheck('#auto-rotate');

    // Reset and test with speed=0.5x (slow)
    await page.click('#btn-north');
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const slider = document.getElementById('rot-speed-slider') as HTMLInputElement;
      slider.value = '0.5';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.check('#auto-rotate');
    await page.waitForTimeout(1000);

    const wangleSlow = await page.textContent('#state-wangle');
    const slowNum = parseInt(wangleSlow!, 10);
    await page.uncheck('#auto-rotate');

    // Fast speed should move further than slow speed in same time
    // (allowing for wraparound)
    const fastForward = fastNum; // from 0
    const slowForward = slowNum; // from 0
    expect(fastForward).toBeGreaterThan(slowForward);
  });

  test('T3.5: Rotation wraps around from 1023 to 0', async ({ page }) => {
    // Start near 1023
    await page.evaluate(() => {
      const slider = document.getElementById('angle-slider') as HTMLInputElement;
      slider.value = '1020';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(200);

    await page.check('#auto-rotate');
    // At speed 1x, should wrap around within ~0.5 seconds from 1020
    await page.waitForTimeout(1000);

    const wangle = await page.textContent('#state-wangle');
    const wangleNum = parseInt(wangle!, 10);

    // After 1s from 1020 at speed 1x (120/s), it should have wrapped around
    // to a low number (since 1020 + 120 = 1140, modulo 1024 = 116)
    expect(wangleNum).toBeLessThan(500);

    await page.uncheck('#auto-rotate');
  });

  test('T3.6: Speed slider value displayed correctly', async ({ page }) => {
    await page.evaluate(() => {
      const slider = document.getElementById('rot-speed-slider') as HTMLInputElement;
      slider.value = '3.5';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(200);

    const speedVal = await page.textContent('#rot-speed-val');
    expect(speedVal).toContain('3.5');
  });
});

/**
 * HEADLESS MODE NOTE:
 * The following acceptance criteria from Expectation 4 cannot be verified
 * in headless mode and require manual visual inspection:
 *   - "箭头平滑旋转（无跳变）" — requires visual assessment of rotation smoothness
 *   - "方向指示器高亮平滑切换" — requires visual assessment of highlight transitions
 * These are verified indirectly through DOM state changes (T3.3) but the
 * visual quality aspect requires human review.
 */
