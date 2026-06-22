/**
 * test-1-wangle-mapping.spec.ts
 *
 * Expectations covered:
 *   Expectation 1: WAngle to angle mapping correctness
 *   Expectation 3: Compass real-time sync
 *
 * Verifies that WAngle values 0, 256, 512, 768 map to the correct
 * direction labels and degrees, and that the compass canvas updates.
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

// WAngle → expected values per README Expectation 1
const WANGLE_TESTS = [
  { wangle: 0,    expectedDeg: 0.0,   expectedDir: '北 N',  toleranceDeg: 3 },
  // OpenRA convention: 0=N, counter-clockwise. 256=W(90°), 512=S(180°), 768=E(270°)
  { wangle: 256,  expectedDeg: 90.0,  expectedDir: '西 W',  toleranceDeg: 3 },
  { wangle: 512,  expectedDeg: 180.0, expectedDir: '南 S',  toleranceDeg: 3 },
  { wangle: 768,  expectedDeg: 270.0, expectedDir: '东 E',  toleranceDeg: 3 },
  { wangle: 1023, expectedDeg: null,  expectedDir: '北 N',  toleranceDeg: 3 },
];

test.describe('Expectation 1 & 3: WAngle Mapping + Compass Sync', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL);
    // Wait for Babylon.js engine to initialize (canvas in #sandbox, and FPS display populated)
    await page.waitForSelector('#info-engine', { state: 'attached', timeout: 15000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('info-engine');
      return el && el.textContent !== '-';
    }, { timeout: 15000 });
    // Verify WebGL is available
    const engineText = await page.textContent('#info-engine');
    expect(engineText).toContain('WebGL');
  });

  test('T1.1: WAngle 0 = North (0°) via button click', async ({ page }) => {
    await page.click('#btn-north');
    await page.waitForTimeout(300);

    const wangle = await page.textContent('#state-wangle');
    const degrees = await page.textContent('#state-degrees');
    const dir = await page.textContent('#state-dir');

    expect(wangle).toBe('0');
    expect(dir).toBe('北 N');
    const degVal = parseFloat(degrees!.replace('°', ''));
    expect(Math.abs(degVal - 0)).toBeLessThanOrEqual(3);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t1-1-wangle-0-north.png'),
      fullPage: false,
    });
  });

  test('T1.2: WAngle 768 = East (270°) via button click', async ({ page }) => {
    await page.click('#btn-east');
    await page.waitForTimeout(300);

    const wangle = await page.textContent('#state-wangle');
    const dir = await page.textContent('#state-dir');
    const degrees = await page.textContent('#state-degrees');

    expect(wangle).toBe('768');
    // OpenRA: WAngle 768 = 270° on WAngle scale = East ('东')
    expect(dir).toBe('东 E');
    const degVal = parseFloat(degrees!.replace('°', ''));
    expect(Math.abs(degVal - 270)).toBeLessThanOrEqual(3);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t1-2-wangle-768-east.png'),
      fullPage: false,
    });
  });

  test('T1.3: WAngle 512 = South (180°) via button click', async ({ page }) => {
    await page.click('#btn-south');
    await page.waitForTimeout(300);

    const wangle = await page.textContent('#state-wangle');
    const dir = await page.textContent('#state-dir');
    const degrees = await page.textContent('#state-degrees');

    expect(wangle).toBe('512');
    expect(dir).toBe('南 S');
    const degVal = parseFloat(degrees!.replace('°', ''));
    expect(Math.abs(degVal - 180)).toBeLessThanOrEqual(3);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t1-3-wangle-512-south.png'),
      fullPage: false,
    });
  });

  test('T1.4: WAngle 256 = West (90°) via button click', async ({ page }) => {
    await page.click('#btn-west');
    await page.waitForTimeout(300);

    const wangle = await page.textContent('#state-wangle');
    const dir = await page.textContent('#state-dir');
    const degrees = await page.textContent('#state-degrees');

    expect(wangle).toBe('256');
    // OpenRA: WAngle 256 = 90° on WAngle scale = West ('西')
    expect(dir).toBe('西 W');
    const degVal = parseFloat(degrees!.replace('°', ''));
    // 256/1024 * 360 = 90°
    expect(Math.abs(degVal - 90)).toBeLessThanOrEqual(3);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t1-4-wangle-256-west.png'),
      fullPage: false,
    });
  });

  test('T1.5: WAngle 1023 ≈ North (359.6°) via slider', async ({ page }) => {
    await page.fill('#angle-slider', '1023');
    // Trigger input event
    await page.evaluate(() => {
      const slider = document.getElementById('angle-slider') as HTMLInputElement;
      slider.value = '1023';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(300);

    const dir = await page.textContent('#state-dir');
    const degrees = await page.textContent('#state-degrees');

    expect(dir).toBe('北 N');
    const degVal = parseFloat(degrees!.replace('°', ''));
    // WAngle 1023 → 1023/1024*360 ≈ 359.6°, should be near 360°/0°
    expect(Math.abs(degVal - 360)).toBeLessThanOrEqual(3);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t1-5-wangle-1023-north.png'),
      fullPage: false,
    });
  });

  test('T1.6: Slider value sync with state display', async ({ page }) => {
    // Set slider to a mid-range value
    await page.evaluate(() => {
      const slider = document.getElementById('angle-slider') as HTMLInputElement;
      slider.value = '384';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(300);

    const sliderVal = await page.inputValue('#angle-slider');
    const stateWangle = await page.textContent('#state-wangle');

    expect(sliderVal).toBe('384');
    expect(stateWangle).toBe('384');
  });

  test('T1.7: Continuous direction scan N→NW→W→SW→S→SE→E→NE→N', async ({ page }) => {
    // Test 8 direction boundaries by setting specific WAngle values
    const directionChecks = [
      { wangle: 0,   expectedDir: '北 N' },
      { wangle: 64,  expectedDir: '西北 NW' },
      { wangle: 192, expectedDir: '西 W' },
      { wangle: 320, expectedDir: '西南 SW' },
      { wangle: 448, expectedDir: '南 S' },
      { wangle: 576, expectedDir: '东南 SE' },
      { wangle: 704, expectedDir: '东 E' },
      { wangle: 832, expectedDir: '东北 NE' },
      { wangle: 1023, expectedDir: '北 N' },
    ];

    for (const check of directionChecks) {
      await page.evaluate((wangle) => {
        const slider = document.getElementById('angle-slider') as HTMLInputElement;
        slider.value = String(wangle);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }, check.wangle);
      await page.waitForTimeout(200);

      const dir = await page.textContent('#state-dir');
      expect(dir).toBe(check.expectedDir);
    }
  });

  test('T1.8: Compass canvas exists and is a 2D canvas', async ({ page }) => {
    const canvasExists = await page.evaluate(() => {
      const canvas = document.getElementById('compass-canvas') as HTMLCanvasElement;
      return canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0;
    });
    expect(canvasExists).toBe(true);

    // Verify compass canvas has content (not blank - has been drawn to)
    // Check center pixel (100,100) where the compass center dot is drawn
    const hasContent = await page.evaluate(() => {
      const canvas = document.getElementById('compass-canvas') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      // Sample multiple pixels around the center area
      const samples = [
        ctx.getImageData(100, 100, 1, 1), // center
        ctx.getImageData(80, 80, 1, 1),   // circle area
        ctx.getImageData(60, 100, 1, 1),  // circle area
      ];
      return samples.some(d => d.data[3] > 0);
    });
    expect(hasContent).toBe(true);
  });

  test('T1.9: Random orientation button works without crash', async ({ page }) => {
    for (let i = 0; i < 5; i++) {
      await page.click('#btn-random');
      await page.waitForTimeout(150);
    }

    // Verify engine is still alive
    const engineText = await page.textContent('#info-engine');
    expect(engineText).toContain('WebGL');

    // Verify state still updating
    const stateWangle = await page.textContent('#state-wangle');
    expect(stateWangle).toBeTruthy();
    const wangle = parseInt(stateWangle!, 10);
    expect(wangle).toBeGreaterThanOrEqual(0);
    expect(wangle).toBeLessThanOrEqual(1023);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t1-9-random-after-5-clicks.png'),
      fullPage: false,
    });
  });
});
