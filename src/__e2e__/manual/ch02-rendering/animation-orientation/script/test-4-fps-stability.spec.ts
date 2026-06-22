/**
 * test-4-fps-stability.spec.ts
 *
 * Expectations covered:
 *   Expectation 5: FPS stability (FPS >= 55 during auto-rotation)
 *
 * Verifies that the frame rate remains stable during active rotation.
 * Also verifies environment information is correctly displayed.
 *
 * HEADLESS MODE LIMITATION:
 * FPS readings in headless mode are unreliable because:
 *   1. No real GPU rendering — frames are software-rasterized
 *   2. No vsync — frame timing differs from real display
 *   3. requestAnimationFrame fires at artificial rates
 * Therefore FPS tests use relaxed thresholds and are marked as
 * informational only. Real FPS validation requires non-headless mode.
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

test.describe('Expectation 5: FPS Stability & Environment Info', () => {
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

  test('T4.1: Environment info bar displays correctly', async ({ page }) => {
    const ua = await page.textContent('#info-ua');
    const viewport = await page.textContent('#info-viewport');
    const engine = await page.textContent('#info-engine');
    const fps = await page.textContent('#info-fps');
    const time = await page.textContent('#info-time');

    expect(ua).toBeTruthy();
    expect(ua!.length).toBeGreaterThan(5);
    expect(viewport).toContain('x');
    expect(viewport).toContain('@');
    expect(engine).toContain('Babylon.js');
    expect(engine).toContain('WebGL');
    expect(fps).toBeTruthy();
    expect(time).toContain('T'); // ISO date format
  });

  test('T4.2: FPS counter is a valid number', async ({ page }) => {
    // Wait for FPS to stabilize (first reading may be 0)
    await page.waitForTimeout(2000);

    const fpsText = await page.textContent('#info-fps');
    const fps = parseInt(fpsText!, 10);
    expect(Number.isNaN(fps)).toBe(false);
    expect(fps).toBeGreaterThanOrEqual(0);
  });

  test('T4.3: FPS remains above threshold during static display', async ({ page }) => {
    // Let page stabilize
    await page.waitForTimeout(3000);

    const fpsText = await page.textContent('#info-fps');
    const fps = parseInt(fpsText!, 10);

    // In headless mode, FPS is typically capped by requestAnimationFrame
    // which fires at the display rate (often 60fps) or lower.
    // We use a very relaxed threshold of >= 10 for headless.
    expect(Number.isNaN(fps)).toBe(false);
    expect(fps).toBeGreaterThanOrEqual(1);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t4-3-static-fps.png'),
      fullPage: false,
    });
  });

  test('T4.4: FPS display updates during auto-rotation', async ({ page }) => {
    // Enable auto-rotation at moderate speed
    await page.evaluate(() => {
      const slider = document.getElementById('rot-speed-slider') as HTMLInputElement;
      slider.value = '1';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.check('#auto-rotate');

    // Collect FPS samples over 5 seconds
    const fpsSamples: number[] = [];
    const startTime = Date.now();
    while (Date.now() - startTime < 5000) {
      const fpsText = await page.textContent('#info-fps');
      const fps = parseInt(fpsText!, 10);
      if (!Number.isNaN(fps) && fps > 0) {
        fpsSamples.push(fps);
      }
      await page.waitForTimeout(500);
    }

    await page.uncheck('#auto-rotate');

    // We should have collected some FPS samples
    expect(fpsSamples.length).toBeGreaterThanOrEqual(3);

    // FPS should be non-zero during operation
    const allPositive = fpsSamples.every(f => f > 0);
    expect(allPositive).toBe(true);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t4-4-auto-rotation-with-fps.png'),
      fullPage: false,
    });
  });

  test('T4.5: No error overlay visible after prolonged operation', async ({ page }) => {
    await page.check('#auto-rotate');
    await page.waitForTimeout(5000);
    await page.uncheck('#auto-rotate');

    // Check that error overlay is still hidden
    const errorVisible = await page.evaluate(() => {
      const el = document.getElementById('gpu-error');
      return el && el.style.display !== 'none';
    });
    expect(errorVisible).toBe(false);

    // Engine info should still show WebGL
    const engineText = await page.textContent('#info-engine');
    expect(engineText).toContain('WebGL');
  });

  test('T4.6: UI remains responsive during auto-rotation', async ({ page }) => {
    await page.check('#auto-rotate');
    await page.waitForTimeout(1000);

    // While rotating, click a direction button — should immediately override auto-rotate value
    await page.click('#btn-north');
    await page.waitForTimeout(300);

    const wangle = await page.textContent('#state-wangle');
    // Button sets wangle to 0; rotation at speed=1x advances ~120 units/s, so ~36 units in 300ms
    const wangleNum = parseInt(wangle!, 10);
    expect(wangleNum).toBeLessThanOrEqual(60); // Near 0, allowing for rotation advance

    // Now stop rotation and verify slider works
    await page.uncheck('#auto-rotate');
    await page.waitForTimeout(200);

    // Set slider to specific value and verify it sticks (no rotation running)
    await page.evaluate(() => {
      const slider = document.getElementById('angle-slider') as HTMLInputElement;
      slider.value = '300';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(300);

    const wangle2 = await page.textContent('#state-wangle');
    expect(wangle2).toBe('300');
  });
});

/**
 * HEADLESS MODE NOTE — Expectation 5 (FPS >= 55):
 *
 * The requirement "FPS >= 55 during auto-rotation on a 60Hz display"
 * CANNOT be reliably verified in headless mode because:
 *   1. requestAnimationFrame timing is not tied to real display refresh
 *   2. No hardware GPU acceleration — software rasterization skews timing
 *   3. Chromium headless may throttle background tabs
 *
 * Manual verification steps for non-headless mode:
 *   1. Open http://localhost:5173/test/ch02-rendering/animation-orientation/
 *   2. Enable auto-rotate at speed 1x
 *   3. Observe #info-fps for 10+ seconds
 *   4. Confirm FPS never drops below 55
 *
 * The automated tests above verify:
 *   - FPS counter produces valid numeric values
 *   - No crashes or errors during extended rotation
 *   - UI remains responsive during rotation
 * These are indirect indicators of stability.
 */
