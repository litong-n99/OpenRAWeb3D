/**
 * Playwright acceptance test: NukePower SelectNukePowerTarget CircleRanges
 * URL: http://localhost:5173/test/ch13-support-powers/nuke/
 * Module: src/OpenRA.Mods.Common/Traits/SupportPowers/NukePower.ts
 *
 * Verifies CircleRanges rendering, color/width configuration, preset switching,
 * custom ranges, and boundary behavior.
 *
 * Evidence output: test-results/manual/ch13-support-powers/nuke/evidence/
 */

import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const BASE_URL = 'http://localhost:5173/test/ch13-support-powers/nuke/';
const EVIDENCE_DIR = path.resolve(
  'test-results', 'manual', 'ch13-support-powers', 'nuke', 'evidence',
);

// ---------------------------------------------------------------------------
// Evidence helpers
// ---------------------------------------------------------------------------

function evidenceFile(name: string): string {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  return path.join(EVIDENCE_DIR, name);
}

async function takeScreenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: evidenceFile(name), fullPage: false });
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseRgba(rgba: string): Rgba | null {
  const m = rgba.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (!m) return null;
  return {
    r: parseInt(m[1], 10),
    g: parseInt(m[2], 10),
    b: parseInt(m[3], 10),
    a: m[4] ? parseFloat(m[4]) : 1,
  };
}

function expectRgbaClose(
  actual: Rgba,
  expected: Rgba,
  rgbTolerance = 5,
  alphaTolerance = 0.02,
): void {
  expect(Math.abs(actual.r - expected.r)).toBeLessThanOrEqual(rgbTolerance);
  expect(Math.abs(actual.g - expected.g)).toBeLessThanOrEqual(rgbTolerance);
  expect(Math.abs(actual.b - expected.b)).toBeLessThanOrEqual(rgbTolerance);
  expect(Math.abs(actual.a - expected.a)).toBeLessThanOrEqual(alphaTolerance);
}

// ---------------------------------------------------------------------------
// Harness types
// ---------------------------------------------------------------------------

interface NukeHarness {
  targetWorldPos: { x: number; y: number; z: number } | null;
  currentRanges: number[];
  circleFillColor: Rgba;
  circleBorderColor: Rgba;
  lineWidth: number;
  borderWidth: number;
  worldToCanvas(x: number, z: number): { x: number; y: number } | null;
  wdistToPixels(wdist: number): number;
  setTarget(x: number, z: number): void;
  clearTarget(): void;
  draw(): void;
}

// ---------------------------------------------------------------------------
// Wait / init helpers
// ---------------------------------------------------------------------------

async function waitRender(page: Page, ms = 300): Promise<void> {
  await page.waitForTimeout(ms);
}

async function waitForHarness(page: Page, timeout = 20000): Promise<void> {
  await page.waitForSelector('#renderCanvas', { state: 'visible', timeout });
  await page.waitForFunction(
    () => {
      const h = (window as any).__nukeTest as Partial<NukeHarness>;
      return (
        !!h &&
        typeof h.setTarget === 'function' &&
        typeof h.wdistToPixels === 'function' &&
        typeof h.worldToCanvas === 'function'
      );
    },
    { timeout },
  );
}

// ---------------------------------------------------------------------------
// Harness wrappers
// ---------------------------------------------------------------------------

async function getHarness(page: Page): Promise<NukeHarness> {
  return page.evaluate(() => (window as any).__nukeTest as NukeHarness);
}

async function setTarget(page: Page, x: number, z: number): Promise<void> {
  await page.evaluate(({ x, z }) => {
    (window as any).__nukeTest.setTarget(x, z);
  }, { x, z });
  await waitRender(page, 150);
}

async function wdistToPixels(page: Page, wdist: number): Promise<number> {
  return page.evaluate((w) => (window as any).__nukeTest.wdistToPixels(w), wdist);
}

async function worldToCanvas(page: Page, x: number, z: number): Promise<{ x: number; y: number } | null> {
  return page.evaluate(({ x, z }) => (window as any).__nukeTest.worldToCanvas(x, z), { x, z });
}

// ---------------------------------------------------------------------------
// DOM state helpers
// ---------------------------------------------------------------------------

async function getStat(page: Page, id: string): Promise<string> {
  return page.evaluate((selectorId) => {
    const el = document.getElementById(selectorId);
    return el ? el.textContent ?? '' : '';
  }, id);
}

async function getTargetText(page: Page): Promise<string> {
  return getStat(page, 'st-target');
}

async function getRangesText(page: Page): Promise<string> {
  return getStat(page, 'st-ranges');
}

async function getFillText(page: Page): Promise<string> {
  return getStat(page, 'st-fill');
}

async function getBorderText(page: Page): Promise<string> {
  return getStat(page, 'st-border');
}

// ---------------------------------------------------------------------------
// Control helpers
// ---------------------------------------------------------------------------

async function setPreset(page: Page, value: string): Promise<void> {
  await page.selectOption('#sel-preset', value);
  await waitRender(page, 200);
}

async function setFillColor(page: Page, hex: string): Promise<void> {
  await page.fill('#color-fill', hex);
  await page.dispatchEvent('#color-fill', 'input');
  await waitRender(page, 150);
}

async function setFillAlpha(page: Page, alpha: number): Promise<void> {
  await page.fill('#range-fill-a', String(alpha));
  await page.dispatchEvent('#range-fill-a', 'input');
  await waitRender(page, 150);
}

async function setBorderColor(page: Page, hex: string): Promise<void> {
  await page.fill('#color-border', hex);
  await page.dispatchEvent('#color-border', 'input');
  await waitRender(page, 150);
}

async function setBorderWidth(page: Page, width: number): Promise<void> {
  await page.fill('#range-border-w', String(width));
  await page.dispatchEvent('#range-border-w', 'input');
  await waitRender(page, 150);
}

async function setLineWidth(page: Page, width: number): Promise<void> {
  await page.fill('#range-line-w', String(width));
  await page.dispatchEvent('#range-line-w', 'input');
  await waitRender(page, 150);
}

async function setCustomRanges(page: Page, r1: number, r2: number, r3: number): Promise<void> {
  await page.fill('#cfg-r1', String(r1));
  await page.fill('#cfg-r2', String(r2));
  await page.fill('#cfg-r3', String(r3));
  await page.click('#btn-apply-custom');
  await waitRender(page, 200);
}

async function clickClearTarget(page: Page): Promise<void> {
  await page.click('#btn-clear-target');
  await waitRender(page, 200);
}

// ---------------------------------------------------------------------------
// Canvas / overlay pixel helpers
// ---------------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

async function getCanvasRect(page: Page): Promise<Rect> {
  return page.evaluate(() => {
    const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    return {
      x: r.x, y: r.y, width: r.width, height: r.height,
      left: r.left, top: r.top, right: r.right, bottom: r.bottom,
    };
  });
}

async function getOverlayPixelCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.getElementById('overlayCanvas') as HTMLCanvasElement | null;
    if (!canvas) return 0;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 10) count++;
    }
    return count;
  });
}

async function sampleOverlayPixel(page: Page, x: number, y: number): Promise<Rgba> {
  return page.evaluate(({ x, y }) => {
    const canvas = document.getElementById('overlayCanvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const data = ctx.getImageData(x, y, 1, 1).data;
    return { r: data[0], g: data[1], b: data[2], a: data[3] / 255 };
  }, { x, y });
}

/**
 * Detect circle boundaries by scanning a horizontal line through the center.
 * Returns the x-coordinates where significant alpha/color transitions occur.
 */
async function findCircleBoundariesOnLine(
  page: Page,
  y: number,
  minAlpha = 20,
): Promise<number[]> {
  return page.evaluate(({ y, minAlpha }) => {
    const canvas = document.getElementById('overlayCanvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const w = canvas.width;
    const data = ctx.getImageData(0, y, w, 1).data;
    const boundaries: number[] = [];
    let inCircle = false;
    for (let x = 0; x < w; x++) {
      const alpha = data[x * 4 + 3];
      const visible = alpha > minAlpha;
      if (visible && !inCircle) {
        boundaries.push(x);
        inCircle = true;
      } else if (!visible && inCircle) {
        boundaries.push(x - 1);
        inCircle = false;
      }
    }
    if (inCircle) boundaries.push(w - 1);
    return boundaries;
  }, { y, minAlpha });
}

/**
 * Detect circle boundaries by scanning a vertical line through the center.
 * Returns the y-coordinates where significant alpha/color transitions occur.
 */
async function findCircleBoundariesOnColumn(
  page: Page,
  x: number,
  minAlpha = 20,
): Promise<number[]> {
  return page.evaluate(({ x, minAlpha }) => {
    const canvas = document.getElementById('overlayCanvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const h = canvas.height;
    const data = ctx.getImageData(x, 0, 1, h).data;
    const boundaries: number[] = [];
    let inCircle = false;
    for (let y = 0; y < h; y++) {
      const alpha = data[y * 4 + 3];
      const visible = alpha > minAlpha;
      if (visible && !inCircle) {
        boundaries.push(y);
        inCircle = true;
      } else if (!visible && inCircle) {
        boundaries.push(y - 1);
        inCircle = false;
      }
    }
    if (inCircle) boundaries.push(h - 1);
    return boundaries;
  }, { x, minAlpha });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('CH13 Support Powers — NukePower CircleRanges', () => {
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
    await expect(page.locator('#info-engine')).not.toHaveText('-', { timeout: 15000 });
    await waitForHarness(page);
    await waitRender(page, 800);
  });

  test.afterEach(async () => {
    expect(consoleErrors, `Console errors: ${consoleErrors.join('; ')}`).toEqual([]);
  });

  // =====================================================================
  // Test 1: Set target point
  // =====================================================================

  test('01 - Set target point: 3 red circles, crosshair, WebGL 2.0', async ({ page }) => {
    // Engine verification
    await expect(page.locator('#info-engine')).toHaveText('WebGL 2.0');

    // Click terrain center (world 7,7)
    const rect = await getCanvasRect(page);
    const centerX = rect.left + rect.width * 0.5;
    const centerY = rect.top + rect.height * 0.5;
    await page.mouse.click(centerX, centerY);
    await waitRender(page, 300);

    // Status panel
    const targetText = await getTargetText(page);
    expect(targetText).not.toBe('无');
    expect(targetText).toMatch(/^\(\d+\.\d+, \d+\.\d+\)$/);

    const rangesText = await getRangesText(page);
    expect(rangesText).toBe('2048, 4096, 6144');

    const fillText = await getFillText(page);
    expect(parseRgba(fillText)).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });

    const borderText = await getBorderText(page);
    expect(parseRgba(borderText)).toEqual({ r: 255, g: 0, b: 0, a: 0.25 });

    // Overlay has visible pixels
    const pixelCount = await getOverlayPixelCount(page);
    expect(pixelCount).toBeGreaterThan(100);

    // Verify radius mapping via harness function
    const px2048 = await wdistToPixels(page, 2048);
    const px4096 = await wdistToPixels(page, 4096);
    const px6144 = await wdistToPixels(page, 6144);
    expect(px4096).toBeCloseTo(px2048 * 2, 1);
    expect(px6144).toBeCloseTo(px2048 * 3, 1);

    // World-to-canvas conversion sanity
    const canvasPos = await worldToCanvas(page, 7, 7);
    expect(canvasPos).not.toBeNull();
    expect(canvasPos!.x).toBeCloseTo(rect.width * 0.5, 1);
    expect(canvasPos!.y).toBeCloseTo(rect.height * 0.5, 1);

    await takeScreenshot(page, '01-set-target-3-circles.png');
  });

  // =====================================================================
  // Test 2: Preset switching
  // =====================================================================

  test('02 - Preset switching: single, concentric, nuke', async ({ page }) => {
    // Start from a known target
    await setTarget(page, 7, 7);

    // Single circle
    await setPreset(page, 'single');
    expect(await getRangesText(page)).toBe('3072');
    let pixelCount = await getOverlayPixelCount(page);
    expect(pixelCount).toBeGreaterThan(50);

    await takeScreenshot(page, '02-preset-single.png');

    // Concentric 5 rings
    await setPreset(page, 'concentric');
    expect(await getRangesText(page)).toBe('1024, 2048, 3072, 4096, 5120');
    pixelCount = await getOverlayPixelCount(page);
    expect(pixelCount).toBeGreaterThan(100);

    await takeScreenshot(page, '03-preset-concentric-5.png');

    // Back to nuke
    await setPreset(page, 'nuke');
    expect(await getRangesText(page)).toBe('2048, 4096, 6144');
    expect(await getOverlayPixelCount(page)).toBeGreaterThan(100);

    await takeScreenshot(page, '04-preset-nuke-restored.png');
  });

  // =====================================================================
  // Test 3: Color configuration
  // =====================================================================

  test('03 - Color configuration: fill green, alpha 200/32, border blue', async ({ page }) => {
    await setTarget(page, 7, 7);

    // Fill green
    await setFillColor(page, '#00ff00');
    let fill = parseRgba(await getFillText(page))!;
    expectRgbaClose(fill, { r: 0, g: 255, b: 0, a: 0.5 });

    await takeScreenshot(page, '05-fill-green.png');

    // Alpha 200
    await setFillAlpha(page, 200);
    fill = parseRgba(await getFillText(page))!;
    expect(fill.a).toBeCloseTo(200 / 255, 2);

    await takeScreenshot(page, '06-fill-alpha-200.png');

    // Alpha 32
    await setFillAlpha(page, 32);
    fill = parseRgba(await getFillText(page))!;
    expect(fill.a).toBeCloseTo(32 / 255, 2);

    await takeScreenshot(page, '07-fill-alpha-32.png');

    // Border blue
    await setBorderColor(page, '#0000ff');
    const border = parseRgba(await getBorderText(page))!;
    expectRgbaClose(border, { r: 0, g: 0, b: 255, a: 0.25 });

    await takeScreenshot(page, '08-border-blue.png');
  });

  // =====================================================================
  // Test 4: Line width / border width
  // =====================================================================

  test('04 - Line width and border width independent adjustment', async ({ page }) => {
    await setTarget(page, 7, 7);

    // Defaults
    expect(await getStat(page, 'val-line-w')).toBe('1');
    expect(await getStat(page, 'val-border-w')).toBe('3');

    // Line width 1 -> 3 -> 6
    await setLineWidth(page, 3);
    expect(await getStat(page, 'val-line-w')).toBe('3');
    await setLineWidth(page, 6);
    expect(await getStat(page, 'val-line-w')).toBe('6');

    await takeScreenshot(page, '09-line-width-6.png');

    // Border width 1 -> 5 -> 8
    await setBorderWidth(page, 1);
    expect(await getStat(page, 'val-border-w')).toBe('1');
    await setBorderWidth(page, 5);
    expect(await getStat(page, 'val-border-w')).toBe('5');
    await setBorderWidth(page, 8);
    expect(await getStat(page, 'val-border-w')).toBe('8');

    await takeScreenshot(page, '10-border-width-8.png');

    // Independent: line=6, border=1
    await setLineWidth(page, 6);
    await setBorderWidth(page, 1);
    expect(await getStat(page, 'val-line-w')).toBe('6');
    expect(await getStat(page, 'val-border-w')).toBe('1');

    await takeScreenshot(page, '11-line-6-border-1.png');
  });

  // =====================================================================
  // Test 5: Custom circle ranges
  // =====================================================================

  test('05 - Custom circle ranges: 512, 2560, 8192', async ({ page }) => {
    await setTarget(page, 7, 7);

    await setCustomRanges(page, 512, 2560, 8192);

    expect(await getRangesText(page)).toBe('512, 2560, 8192');
    expect(await page.locator('#sel-preset').inputValue()).toBe('custom');

    // Verify radius scaling
    const px512 = await wdistToPixels(page, 512);
    const px2560 = await wdistToPixels(page, 2560);
    const px8192 = await wdistToPixels(page, 8192);
    expect(px2560).toBeCloseTo(px512 * 5, 1);
    expect(px8192).toBeCloseTo(px512 * 16, 1);

    await takeScreenshot(page, '12-custom-ranges.png');
  });

  // =====================================================================
  // Test 6: Clear target
  // =====================================================================

  test('06 - Clear target removes circles and resets status', async ({ page }) => {
    await setTarget(page, 7, 7);
    expect(await getTargetText(page)).not.toBe('无');
    expect(await getOverlayPixelCount(page)).toBeGreaterThan(100);

    await clickClearTarget(page);

    expect(await getTargetText(page)).toBe('无');
    expect(await getOverlayPixelCount(page)).toBe(0);

    await takeScreenshot(page, '13-cleared-target.png');
  });

  // =====================================================================
  // Test 7: Boundary - radius 0
  // =====================================================================

  test('07 - Boundary: radius 0 produces no circle', async ({ page }) => {
    await setTarget(page, 7, 7);
    await setCustomRanges(page, 0, 0, 0);

    expect(await getRangesText(page)).toBe('-');
    // Crosshair still drawn, so a few pixels are visible but no circle area.
    // Crosshair is ~60 px; allow small margin.
    const pixelCount = await getOverlayPixelCount(page);
    expect(pixelCount).toBeLessThan(100);

    await takeScreenshot(page, '14-radius-zero.png');
  });

  // =====================================================================
  // Test 8: Alpha extremes
  // =====================================================================

  test('08 - Alpha extremes: 0 invisible fill, 255 opaque fill', async ({ page }) => {
    await setTarget(page, 7, 7);
    await setPreset(page, 'single');

    const center = await worldToCanvas(page, 7, 7);
    const radius = await wdistToPixels(page, 3072);
    expect(center).not.toBeNull();
    const sampleX = Math.round(center!.x + radius * 0.5);
    const sampleY = Math.round(center!.y);

    // Alpha 0: fill invisible
    await setFillColor(page, '#ff0000');
    await setFillAlpha(page, 0);
    let fill = parseRgba(await getFillText(page))!;
    expect(fill.a).toBe(0);

    // Sample inside the circle: should see mostly terrain, not red fill
    const pixelAlpha0 = await sampleOverlayPixel(page, sampleX, sampleY);
    expect(pixelAlpha0.a).toBeLessThanOrEqual(0.05);

    await takeScreenshot(page, '15-alpha-0-fill-invisible.png');

    // Alpha 255: fill opaque
    await setFillAlpha(page, 255);
    fill = parseRgba(await getFillText(page))!;
    expect(fill.a).toBe(1);

    const pixelAlpha255 = await sampleOverlayPixel(page, sampleX, sampleY);
    expect(pixelAlpha255.a).toBeGreaterThanOrEqual(0.95);
    expectRgbaClose(pixelAlpha255, { r: 255, g: 0, b: 0, a: 1 }, 20, 0.1);

    await takeScreenshot(page, '16-alpha-255-fill-opaque.png');
  });

  // =====================================================================
  // Test 9: Aspect ratio / perfect circles
  // =====================================================================

  test('09 - Circles are perfect circles (1:1 aspect ratio)', async ({ page }) => {
    await setTarget(page, 7, 7);
    await setPreset(page, 'single');

    const center = await worldToCanvas(page, 7, 7);
    expect(center).not.toBeNull();
    const cx = Math.round(center!.x);
    const cy = Math.round(center!.y);

    // Detect horizontal and vertical boundaries of the single circle.
    // Use a higher alpha threshold to ignore anti-aliasing fringes.
    const hBounds = await findCircleBoundariesOnLine(page, cy, 40);
    const vBounds = await findCircleBoundariesOnColumn(page, cx, 40);

    expect(hBounds.length).toBeGreaterThanOrEqual(2);
    expect(vBounds.length).toBeGreaterThanOrEqual(2);

    const hDiameter = hBounds[hBounds.length - 1] - hBounds[0];
    const vDiameter = vBounds[vBounds.length - 1] - vBounds[0];

    // Assert the circle is not stretched: diameters match within 5% and 20px.
    expect(Math.abs(hDiameter - vDiameter)).toBeLessThanOrEqual(20);
    const ratio = Math.max(hDiameter, vDiameter) / Math.min(hDiameter, vDiameter);
    expect(ratio).toBeLessThanOrEqual(1.05);

    await takeScreenshot(page, '17-circle-aspect-ratio.png');
  });
});
