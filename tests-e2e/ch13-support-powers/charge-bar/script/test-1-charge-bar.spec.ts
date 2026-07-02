/**
 * Playwright acceptance test: SupportPowerChargeBar
 * URL: http://localhost:5173/test/ch13-support-powers/charge-bar/
 * Module: src/OpenRA.Mods.Common/Traits/Render/SupportPowerChargeBar.ts
 *
 * Verifies 6 expected results + 3 edge cases.
 * Evidence output: test-results/manual/ch13-support-powers/charge-bar/evidence/
 */

import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const BASE_URL = 'http://localhost:5173/test/ch13-support-powers/charge-bar/';
const EVIDENCE_DIR = path.resolve(
  'test-results', 'manual', 'ch13-support-powers', 'charge-bar', 'evidence',
);

function evidenceFile(name: string): string {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  return path.join(EVIDENCE_DIR, name);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const v = parseInt(hex.replace('#', ''), 16);
  return {
    r: (v >> 16) & 0xff,
    g: (v >> 8) & 0xff,
    b: v & 0xff,
  };
}

async function waitRender(page: Page, ms = 300): Promise<void> {
  // Allow Babylon.js render loop to process at least one frame
  await page.waitForTimeout(ms);
}

// ---------------------------------------------------------------------------
// Test API wrappers (using window.__chargeBarTest)
// ---------------------------------------------------------------------------

async function setProgress(page: Page, p: number): Promise<void> {
  await page.evaluate((value) => {
    (window as unknown as Record<string, unknown>).__chargeBarTest.setProgress(value);
  }, p);
  await waitRender(page, 100);
}

async function setColor(page: Page, hex: string): Promise<void> {
  await page.evaluate((value) => {
    (window as unknown as Record<string, unknown>).__chargeBarTest.setColor(value);
  }, hex);
  await waitRender(page, 100);
}

async function clickActive(page: Page): Promise<void> {
  await page.click('#btn-active');
  await waitRender(page, 150);
}

async function clickDisabled(page: Page): Promise<void> {
  await page.click('#btn-disabled');
  await waitRender(page, 150);
}

async function clickPaused(page: Page): Promise<void> {
  await page.click('#btn-paused');
  await waitRender(page, 150);
}

async function setDisplayWhenEmpty(page: Page, value: boolean): Promise<void> {
  const id = value ? '#btn-show-always' : '#btn-show-empty';
  await page.click(id);
  await waitRender(page, 150);
}

// ---------------------------------------------------------------------------
// Scene introspection via window.__chargeBarScene
// ---------------------------------------------------------------------------

async function getBarPlaneEnabled(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const scene = (window as unknown as Record<string, unknown>).__chargeBarScene;
    return (scene as any).getMeshByName('chargeBarPlane').isEnabled();
  });
}

async function getBuildingColor(page: Page): Promise<{ r: number; g: number; b: number }> {
  return page.evaluate(() => {
    const scene = (window as unknown as Record<string, unknown>).__chargeBarScene;
    const building = (scene as any).getMeshByName('building');
    const c = building.material.diffuseColor;
    return {
      r: Math.round(c.r * 255),
      g: Math.round(c.g * 255),
      b: Math.round(c.b * 255),
    };
  });
}

interface BarMetrics {
  enabled: boolean;
  fillWidth: number;
  sampleColor: { r: number; g: number; b: number };
}

async function getBarMetrics(page: Page): Promise<BarMetrics> {
  return page.evaluate(() => {
    const scene = (window as unknown as Record<string, unknown>).__chargeBarScene;
    const plane = (scene as any).getMeshByName('chargeBarPlane');
    const enabled = plane.isEnabled();
    const texture = plane.material.diffuseTexture;
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    const canvas = ctx.canvas as HTMLCanvasElement;
    const w = canvas.width;
    const h = canvas.height;
    const data = ctx.getImageData(0, 0, w, h).data;

    // Scan fill width from the top-left fill region (row 20, skipping 4px padding)
    const y = 20;
    let fillWidth = 0;
    // Background is rgb(38,38,38)
    const bgR = 38, bgG = 38, bgB = 38;
    const tol = 15;
    for (let x = 4; x < w - 4; x++) {
      const idx = (y * w + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
      if (a < 10) break; // fully transparent -> no content
      const isBg =
        Math.abs(r - bgR) < tol &&
        Math.abs(g - bgG) < tol &&
        Math.abs(b - bgB) < tol;
      if (isBg) break;
      fillWidth++;
    }

    // Sample color at (10, 20) — should be in fill region when progress > 0
    const sx = 10, sy = 20;
    const sidx = (sy * w + sx) * 4;
    return {
      enabled,
      fillWidth,
      sampleColor: {
        r: data[sidx],
        g: data[sidx + 1],
        b: data[sidx + 2],
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Helper: expect RGB values within tolerance
// ---------------------------------------------------------------------------

function expectRgbClose(
  actual: { r: number; g: number; b: number },
  expected: { r: number; g: number; b: number },
  tolerance = 10,
): void {
  expect(Math.abs(actual.r - expected.r)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.g - expected.g)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.b - expected.b)).toBeLessThanOrEqual(tolerance);
}

// =========================================================================
// Test Suite
// =========================================================================

test.describe('SupportPowerChargeBar', () => {
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(err.message);
    });

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(BASE_URL);
    // Wait for WebGL engine to initialize
    await expect(page.locator('#info-engine')).not.toHaveText('-', { timeout: 15000 });
    await waitRender(page, 800);
  });

  test.afterEach(async () => {
    // No console/page errors allowed
    expect(consoleErrors, `Console errors: ${consoleErrors.join('; ')}`).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Expected Result 1: 0% empty bar
  // -----------------------------------------------------------------------

  test('01 - 0% empty bar (DisplayWhenEmpty=true)', async ({ page }) => {
    await clickActive(page);
    await setDisplayWhenEmpty(page, true);
    await setProgress(page, 0);

    // DOM validation
    await expect(page.locator('#val-charge')).toHaveText('0%');
    await expect(page.locator('#st-progress')).toHaveText('0.00');
    await expect(page.locator('#st-visible')).toHaveText('是'); // visible because DisplayWhenEmpty=true

    // Scene validation
    const metrics = await getBarMetrics(page);
    expect(metrics.enabled, 'bar plane should be enabled').toBe(true);
    expect(metrics.fillWidth, 'fill width should be 0 at 0%').toBe(0);

    await page.screenshot({ path: evidenceFile('01-empty-0pct.png'), fullPage: false });
  });

  // -----------------------------------------------------------------------
  // Expected Result 2: 50% half bar
  // -----------------------------------------------------------------------

  test('02 - 50% half bar', async ({ page }) => {
    await clickActive(page);
    await setDisplayWhenEmpty(page, false);
    await setProgress(page, 0.5);

    // DOM validation
    await expect(page.locator('#val-charge')).toHaveText('50%');
    await expect(page.locator('#st-progress')).toHaveText('0.50');
    await expect(page.locator('#st-visible')).toHaveText('是');

    // Scene validation: fillWidth = 252 (504 * 0.5)
    const metrics = await getBarMetrics(page);
    expect(metrics.enabled, 'bar plane should be enabled').toBe(true);
    expect(metrics.fillWidth, 'fill width should be 252 at 50%').toBe(252);

    // Color validation: default Magenta #FF00FF
    const magenta = hexToRgb('#ff00ff');
    expectRgbClose(metrics.sampleColor, magenta, 5);

    await page.screenshot({ path: evidenceFile('02-half-50pct.png'), fullPage: false });
  });

  // -----------------------------------------------------------------------
  // Expected Result 3: 100% full bar
  // -----------------------------------------------------------------------

  test('03 - 100% full bar', async ({ page }) => {
    await clickActive(page);
    await setDisplayWhenEmpty(page, false);
    await setProgress(page, 1.0);

    // DOM validation
    await expect(page.locator('#val-charge')).toHaveText('100%');
    await expect(page.locator('#st-progress')).toHaveText('1.00');
    await expect(page.locator('#st-visible')).toHaveText('是');

    // Scene validation: fillWidth = 504 (full bar)
    const metrics = await getBarMetrics(page);
    expect(metrics.enabled, 'bar plane should be enabled').toBe(true);
    expect(metrics.fillWidth, 'fill width should be 504 at 100%').toBe(504);

    await page.screenshot({ path: evidenceFile('03-full-100pct.png'), fullPage: false });
  });

  // -----------------------------------------------------------------------
  // Expected Result 4: Color matching with presets
  // -----------------------------------------------------------------------

  test('04 - Color matching with presets', async ({ page }) => {
    await clickActive(page);
    await setProgress(page, 0.5);

    const presets = [
      { name: 'magenta', hex: '#ff00ff' },
      { name: 'green', hex: '#00ff00' },
      { name: 'red', hex: '#ff4444' },
      { name: 'blue', hex: '#44aaff' },
      { name: 'orange', hex: '#ffaa00' },
    ];

    for (const preset of presets) {
      await page.selectOption('#color-preset', preset.hex);
      await waitRender(page, 200);

      // DOM validation: color picker and status panel sync
      await expect(page.locator('#color-picker')).toHaveValue(preset.hex);
      await expect(page.locator('#st-color')).toHaveText(preset.hex);

      // Scene validation: fill color matches preset
      const metrics = await getBarMetrics(page);
      expect(metrics.enabled, `bar should be enabled for ${preset.name}`).toBe(true);
      expect(metrics.fillWidth, `fill width should be 252 for ${preset.name}`).toBe(252);

      const expected = hexToRgb(preset.hex);
      expectRgbClose(metrics.sampleColor, expected, 5);

      await page.screenshot({ path: evidenceFile(`04-color-${preset.name}.png`), fullPage: false });
    }
  });

  // -----------------------------------------------------------------------
  // Expected Result 5: DisplayWhenEmpty behavior
  // -----------------------------------------------------------------------

  test('05 - DisplayWhenEmpty behavior', async ({ page }) => {
    await clickActive(page);
    await setProgress(page, 0);

    // Default: displayWhenEmpty=false → bar hidden at 0%
    await setDisplayWhenEmpty(page, false);
    await expect(page.locator('#st-visible')).toHaveText('否');
    expect(await getBarPlaneEnabled(page), 'bar should be hidden when DisplayWhenEmpty=false and 0%').toBe(false);
    await page.screenshot({ path: evidenceFile('05-empty-hidden.png'), fullPage: false });

    // Toggle to true → empty frame visible
    await setDisplayWhenEmpty(page, true);
    await expect(page.locator('#st-visible')).toHaveText('是');
    expect(await getBarPlaneEnabled(page), 'bar should be visible when DisplayWhenEmpty=true').toBe(true);

    const metrics = await getBarMetrics(page);
    expect(metrics.enabled).toBe(true);
    expect(metrics.fillWidth, 'fill width should be 0 even when visible').toBe(0);

    await page.screenshot({ path: evidenceFile('06-empty-visible-frame.png'), fullPage: false });

    // Toggle back to false → hidden again
    await setDisplayWhenEmpty(page, false);
    await expect(page.locator('#st-visible')).toHaveText('否');
    expect(await getBarPlaneEnabled(page), 'bar should be hidden again after toggle back').toBe(false);
  });

  // -----------------------------------------------------------------------
  // Expected Result 6: Disabled/Paused hides bar; Active restores
  // -----------------------------------------------------------------------

  test('06 - Building state: Disabled / Paused / Active', async ({ page }) => {
    await clickActive(page);
    await setProgress(page, 0.5);
    await setDisplayWhenEmpty(page, false);

    // Active state
    await expect(page.locator('#st-building')).toHaveText('Active');
    await expect(page.locator('#st-visible')).toHaveText('是');
    expect(await getBarPlaneEnabled(page)).toBe(true);
    expectRgbClose(await getBuildingColor(page), { r: 102, g: 128, b: 153 }, 3); // blue-grey
    await page.screenshot({ path: evidenceFile('07-state-active.png'), fullPage: false });

    // Disabled state
    await clickDisabled(page);
    await expect(page.locator('#st-building')).toHaveText('Disabled');
    await expect(page.locator('#st-visible')).toHaveText('否');
    expect(await getBarPlaneEnabled(page), 'bar should be hidden when Disabled').toBe(false);
    expectRgbClose(await getBuildingColor(page), { r: 64, g: 38, b: 38 }, 3); // dark red
    await page.screenshot({ path: evidenceFile('08-state-disabled.png'), fullPage: false });

    // Paused state
    await clickPaused(page);
    await expect(page.locator('#st-building')).toHaveText('Paused');
    await expect(page.locator('#st-visible')).toHaveText('否');
    expect(await getBarPlaneEnabled(page), 'bar should be hidden when Paused').toBe(false);
    expectRgbClose(await getBuildingColor(page), { r: 102, g: 102, b: 51 }, 3); // dark yellow
    await page.screenshot({ path: evidenceFile('09-state-paused.png'), fullPage: false });

    // Back to Active
    await clickActive(page);
    await expect(page.locator('#st-building')).toHaveText('Active');
    await expect(page.locator('#st-visible')).toHaveText('是');
    expect(await getBarPlaneEnabled(page), 'bar should reappear when Active').toBe(true);
    expectRgbClose(await getBuildingColor(page), { r: 102, g: 128, b: 153 }, 3);
    await page.screenshot({ path: evidenceFile('10-state-restored.png'), fullPage: false });
  });

  // -----------------------------------------------------------------------
  // Edge Case A: Rapid progress change 100% → 0%
  // -----------------------------------------------------------------------

  test('07 - Edge: Rapid progress change 100% → 0%', async ({ page }) => {
    await clickActive(page);
    await setDisplayWhenEmpty(page, true);

    // Rapid toggle 5 times
    for (let i = 0; i < 5; i++) {
      await setProgress(page, 1.0);
      await setProgress(page, 0.0);
    }
    await setProgress(page, 0.0);
    await waitRender(page, 200);

    // Final state: 0% with visible frame (DisplayWhenEmpty=true)
    await expect(page.locator('#val-charge')).toHaveText('0%');
    const metrics = await getBarMetrics(page);
    expect(metrics.enabled).toBe(true);
    expect(metrics.fillWidth, 'fill width should be 0 after rapid toggle').toBe(0);

    await page.screenshot({ path: evidenceFile('11-edge-rapid-progress.png'), fullPage: false });
  });

  // -----------------------------------------------------------------------
  // Edge Case B: Fast color switching
  // -----------------------------------------------------------------------

  test('08 - Edge: Fast color switching', async ({ page }) => {
    await clickActive(page);
    await setProgress(page, 0.5);
    await setDisplayWhenEmpty(page, true);

    const colors = ['#ff00ff', '#00ff00', '#ff4444', '#44aaff', '#ffaa00'];
    // Rapidly cycle through colors 20 times
    for (let i = 0; i < 20; i++) {
      await setColor(page, colors[i % colors.length]);
      await page.waitForTimeout(100);
    }

    // Final state: should display the last set color
    const final = '#44aaff';
    await setColor(page, final);
    await waitRender(page, 200);

    await expect(page.locator('#st-color')).toHaveText(final);
    const metrics = await getBarMetrics(page);
    expect(metrics.enabled).toBe(true);
    expect(metrics.fillWidth).toBe(252);

    const expected = hexToRgb(final);
    expectRgbClose(metrics.sampleColor, expected, 5);

    await page.screenshot({ path: evidenceFile('12-edge-fast-color.png'), fullPage: false });
  });

  // -----------------------------------------------------------------------
  // Edge Case C: Camera rotation keeps bar visible
  // -----------------------------------------------------------------------

  test('09 - Edge: Camera rotation keeps bar visible', async ({ page }) => {
    await clickActive(page);
    await setProgress(page, 0.5);
    await setDisplayWhenEmpty(page, true);

    const angles = [
      { alpha: 0, beta: Math.PI / 3 },
      { alpha: Math.PI / 2, beta: Math.PI / 3 },
      { alpha: Math.PI, beta: Math.PI / 4 },
      { alpha: -Math.PI / 2, beta: Math.PI / 4 },
      { alpha: -Math.PI / 3, beta: 0.15 }, // almost edge-on
    ];

    for (let i = 0; i < angles.length; i++) {
      await page.evaluate(({ alpha, beta }) => {
        const scene = (window as unknown as Record<string, unknown>).__chargeBarScene;
        const cam = (scene as any).cameras[0];
        cam.alpha = alpha;
        cam.beta = beta;
      }, angles[i]);
      await waitRender(page, 300);

      // Bar plane should remain enabled from all angles
      expect(
        await getBarPlaneEnabled(page),
        `bar should be enabled at camera angle ${i}`,
      ).toBe(true);

      await page.screenshot({
        path: evidenceFile(`13-edge-camera-angle-${i}.png`),
        fullPage: false,
      });
    }
  });
});
